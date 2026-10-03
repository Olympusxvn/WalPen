import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.ts";
import { synchronize } from "../server/synchronize.ts";
import { retryWindow, WRITE_LEASE_MS } from "../server/write-intent.ts";
import {
  DeduplicatingRelayer,
  journal,
  recoveryScenarios,
  recoveryStart,
  recoveryWindow,
} from "./recovery-fixtures.ts";
import { WalrusMemory } from "../server/memory.ts";

test("SQLite: durable recovery, deduplication, fencing, isolation and retry limits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "walpen-idempotency-"));
  const path = join(dir, "test.sqlite"),
    key = randomBytes(32);
  const a = new Store(path, key),
    b = new Store(path, key);
  try {
    await recoveryScenarios(a, b);
  } finally {
    a.db.close();
    b.db.close();
    rmSync(dir, { recursive: true });
  }
});

test("SQLite snapshot restores encrypted intent, stable key and receipt recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "walpen-idempotency-")),
    key = randomBytes(32);
  const a = new Store(join(dir, "source.sqlite"), key),
    remote = new DeduplicatingRelayer();
  const snapshot = join(dir, "snapshot.sqlite");
  let b: Store | undefined;
  try {
    a.addUser({
      id: "fixture",
      username: "fixture",
      password: "fixture",
      createdAt: "now",
    });
    const e = journal("fixture");
    a.insert(e);
    remote.loseResponse = true;
    await synchronize(a, remote, e, recoveryWindow, recoveryStart);
    const original = a.writeIntent(e.id)!;
    const payload = a.db
      .prepare("SELECT payload FROM write_intents WHERE entryId=?")
      .get(e.id)!.payload as string;
    assert.ok(!payload.includes(e.body));
    a.db.prepare("VACUUM INTO ?").run(snapshot);
    b = new Store(snapshot, key);
    assert.deepEqual(b.writeIntent(e.id), original);
    remote.loseResponse = false;
    await synchronize(
      b,
      remote,
      e,
      recoveryWindow,
      recoveryStart + WRITE_LEASE_MS + 1,
    );
    assert.equal(remote.jobs.size, 1);
    assert.equal(b.get(e.id, e.userId)!.status, "synced");
    assert.equal(b.writeIntent(e.id)!.intent.key, original.intent.key);
  } finally {
    a.db.close();
    b?.db.close();
    rmSync(dir, { recursive: true });
  }
});

test("SQLite actual transaction rollback prevents write when intent persistence fails", async () => {
  const a = new Store(":memory:", randomBytes(32)),
    remote = new DeduplicatingRelayer();
  try {
    a.addUser({
      id: "fixture",
      username: "fixture",
      password: "fixture",
      createdAt: "now",
    });
    const e = journal("fixture");
    a.insert(e);
    a.db.exec(
      "CREATE TRIGGER fail_intent BEFORE INSERT ON write_intents BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    );
    await assert.rejects(
      synchronize(a, remote, e, recoveryWindow, recoveryStart),
    );
    assert.equal(a.get(e.id, e.userId)!.status, "queued");
    assert.equal(a.writeIntent(e.id), undefined);
    assert.equal(remote.jobs.size, 0);
  } finally {
    a.db.close();
  }
});

test("retry configuration fails closed", () => {
  assert.equal(retryWindow(undefined), 0);
  assert.equal(retryWindow("0"), 0);
  assert.equal(retryWindow("3600000"), 3600000);
  for (const value of ["NaN", "-1", "Infinity", "1.5", "86400001"])
    assert.throws(() => retryWindow(value));
});

test("gateway passes frozen text, namespace and explicit SDK idempotencyKey", async () => {
  const gateway = new WalrusMemory(),
    e = journal("fixture");
  const intent = { ...gateway.prepare(e), key: "opaque-test-key" };
  let seen: unknown[] = [];
  gateway.client = (() => ({
    remember: async (...args: unknown[]) => {
      seen = args;
      return { job_id: "accepted-job" };
    },
  })) as unknown as typeof gateway.client;
  assert.equal(await gateway.remember(e, intent), "accepted-job");
  assert.deepEqual(seen, [
    intent.text,
    intent.namespace,
    { idempotencyKey: intent.key },
  ]);
  await assert.rejects(gateway.remember({ ...e, body: "changed" }, intent));
});

test("legacy migration preserves receipts, polls known jobs and refuses keyless uncertain writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "walpen-idempotency-")),
    key = randomBytes(32);
  const path = join(dir, "legacy.sqlite"),
    a = new Store(path, key);
  let b: Store | undefined;
  try {
    a.addUser({
      id: "fixture",
      username: "fixture",
      password: "fixture",
      createdAt: "now",
    });
    const remote = new DeduplicatingRelayer(),
      queued = journal("fixture"),
      unknown = journal("fixture", { status: "submitting" });
    const accepted = journal("fixture", { status: "pending" });
    accepted.jobId = await remote.remember(accepted, {
      ...remote.prepare(accepted),
      key: "old-sdk-key",
    });
    const done = journal("fixture", {
      status: "synced",
      jobId: "old-job",
      blobId: "old-receipt",
    });
    for (const e of [queued, unknown, accepted, done]) a.insert(e);
    a.db.exec("DROP TABLE write_intents");
    a.db.close();
    b = new Store(path, key);
    assert.equal(b.get(unknown.id, "fixture")!.status, "uncertain");
    for (const e of b.pending("fixture", recoveryWindow, recoveryStart))
      await synchronize(b, remote, e, recoveryWindow, recoveryStart);
    assert.equal(b.writeIntent(unknown.id), undefined);
    assert.ok(b.writeIntent(queued.id));
    assert.equal(b.get(accepted.id, "fixture")!.status, "synced");
    assert.equal(b.get(done.id, "fixture")!.blobId, "old-receipt");
    assert.equal(remote.jobs.size, 2);
    assert.equal(remote.submissions, 2);
  } finally {
    if (a.db.isOpen) a.db.close();
    b?.db.close();
    rmSync(dir, { recursive: true });
  }
});
