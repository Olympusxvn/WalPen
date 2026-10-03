import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Repository } from "../server/repository.ts";
import type { Entry } from "../server/store.ts";
import type { MemoryGateway } from "../server/memory.ts";
import {
  serializeMemory,
  sameDraft,
  WRITE_LEASE_MS,
  type WriteIntent,
} from "../server/write-intent.ts";
import { synchronize } from "../server/synchronize.ts";

export class DeduplicatingRelayer implements MemoryGateway {
  configured = true;
  jobs = new Map<string, { intent: WriteIntent; job: string; blob: string }>();
  submissions = 0;
  polls = 0;
  loseResponse = false;
  timeoutPoll = false;
  beforeSubmit?: () => Promise<void>;
  prepare(e: Entry) {
    return {
      accountId: "fake-owner",
      serverUrl: "https://fake.invalid",
      namespace: `walpen-v1-${e.userId}`,
      text: serializeMemory(e),
    };
  }
  async remember(_e: Entry, intent: WriteIntent) {
    await this.beforeSubmit?.();
    this.submissions++;
    const scopedKey = `${intent.accountId}:${intent.key}`;
    let job = this.jobs.get(scopedKey);
    if (job && !sameDraft(job.intent, intent)) throw new Error("409 conflict");
    if (!job) {
      const id = randomUUID();
      job = {
        intent: structuredClone(intent),
        job: `job-${id}`,
        blob: `blob-${id}`,
      };
      this.jobs.set(scopedKey, job);
    }
    if (this.loseResponse) throw new Error("Accepted remotely, response lost");
    return job.job;
  }
  async wait(_user: string, id: string) {
    this.polls++;
    if (this.timeoutPoll) throw new Error("poll timeout");
    const job = [...this.jobs.values()].find((j) => j.job === id);
    if (!job) throw new Error("Unknown fake job");
    return job.blob;
  }
  async recall() {
    return { results: [] };
  }
}
export const recoveryWindow = 3_600_000;
export const recoveryStart = 1_800_000_000_000;
export function journal(userId: string, extra: Partial<Entry> = {}): Entry {
  const id = randomUUID();
  return {
    id,
    userId,
    rootId: id,
    revision: 1,
    supersedes: null,
    title: "Fictional entry",
    body: "Private fixture body",
    memory: "Walking helps",
    mood: "calm",
    consent: true,
    createdAt: new Date(recoveryStart).toISOString(),
    occurredAt: new Date(recoveryStart).toISOString(),
    status: "queued",
    jobId: null,
    blobId: null,
    error: null,
    retired: false,
    ...extra,
  };
}
/** Runs against real SQLite and PostgreSQL implementations; only the relayer is fake. */
export async function recoveryScenarios(a: Repository, b: Repository) {
  const user = randomUUID(),
    other = randomUUID();
  for (const id of [user, other])
    await a.addUser({
      id,
      username: id,
      password: "test",
      createdAt: new Date().toISOString(),
    });
  const make = async (extra: Partial<Entry> = {}) => {
    const e = journal(user, extra);
    await a.insert(e);
    return e;
  };
  const next = recoveryStart + WRITE_LEASE_MS + 1;

  // Persist failure: remote must never see the request, including on a later retry.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    const broken = new Proxy(a, {
      get(target, p) {
        if (p === "claim")
          return async () => {
            throw new Error("database unavailable");
          };
        const v = Reflect.get(target, p);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await assert.rejects(
      synchronize(broken, remote, e, recoveryWindow, recoveryStart),
    );
    assert.equal(remote.jobs.size, 0);
    assert.equal((await a.get(e.id, user))!.status, "queued");
    assert.equal(await a.writeIntent(e.id), undefined);
    await synchronize(b, remote, e, recoveryWindow, next);
    assert.equal(remote.jobs.size, 1);
  }
  // Commit then crash before network: stable key recovered from the other instance.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    const lease = (await a.claim(
      e.id,
      remote.prepare(e),
      recoveryWindow,
      recoveryStart,
    ))!;
    assert.ok(lease.intent.key);
    await synchronize(b, remote, e, recoveryWindow, recoveryStart + 1);
    assert.equal(
      remote.jobs.size,
      0,
      "active lease excludes the other instance",
    );
    await synchronize(b, remote, e, recoveryWindow, next);
    assert.equal(remote.jobs.size, 1);
    assert.equal((await b.writeIntent(e.id))!.intent.key, lease.intent.key);
  }
  // Accepted but response lost; a later instance resubmits the exact frozen intent.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    remote.loseResponse = true;
    remote.beforeSubmit = async () => {
      assert.ok(
        (await b.writeIntent(e.id))?.intent.key,
        "intent committed before I/O",
      );
    };
    await synchronize(a, remote, e, recoveryWindow, recoveryStart);
    const initial = (await a.writeIntent(e.id))!;
    assert.equal((await a.get(e.id, user))!.status, "uncertain");
    // Recreate the gateway: only the fake server's durable jobs survive.
    const freshClient = new DeduplicatingRelayer();
    freshClient.jobs = remote.jobs;
    await Promise.all([
      synchronize(a, freshClient, e, recoveryWindow, next),
      synchronize(b, freshClient, e, recoveryWindow, next),
    ]);
    assert.equal(remote.submissions + freshClient.submissions, 2);
    assert.equal(remote.jobs.size, 1);
    assert.equal((await b.get(e.id, user))!.status, "synced");
    assert.deepEqual((await b.writeIntent(e.id))!.intent, initial.intent);
    assert.equal(
      await a.sync(e.id, "failed", null, null, "late failure", initial.token),
      false,
    );
    const receipt = (await a.get(e.id, user))!.blobId;
    await a.sync(e.id, "synced", "wrong-job", "wrong-blob", null);
    assert.equal((await a.get(e.id, user))!.blobId, receipt);
  }
  // Accepted, then DB goes down before job persistence (both save attempts fail).
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    const broken = new Proxy(a, {
      get(target, p) {
        if (p === "sync")
          return async () => {
            throw new Error("DB offline");
          };
        const v = Reflect.get(target, p);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await assert.rejects(
      synchronize(broken, remote, e, recoveryWindow, recoveryStart),
    );
    assert.equal(remote.jobs.size, 1);
    assert.equal(remote.polls, 0, "never poll before persisting job ID");
    assert.equal((await b.get(e.id, user))!.jobId, null);
    await synchronize(b, remote, e, recoveryWindow, next);
    assert.equal(remote.jobs.size, 1);
    assert.equal((await b.get(e.id, user))!.status, "synced");
  }
  // Job known: no resubmit, even outside the replay window or after withdrawal.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    const wait = remote.wait.bind(remote);
    remote.wait = async (owner, job) => {
      assert.equal(
        (await b.get(e.id, user))!.jobId,
        job,
        "job is durable before the first poll",
      );
      return wait(owner, job);
    };
    remote.timeoutPoll = true;
    await synchronize(a, remote, e, 0, recoveryStart);
    assert.ok((await a.get(e.id, user))!.jobId);
    await make({
      rootId: e.rootId,
      supersedes: e.id,
      revision: 2,
      consent: false,
      memory: "",
    });
    remote.timeoutPoll = false;
    await synchronize(b, remote, e, 0, recoveryStart + recoveryWindow * 2);
    assert.equal(remote.submissions, 1);
    assert.equal(remote.jobs.size, 1);
    assert.equal((await b.get(e.id, user))!.status, "synced");
  }
  // A transient failure to save a received receipt must not discard that receipt.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    let failed = false;
    const flaky = new Proxy(a, {
      get(target, p) {
        if (p === "sync")
          return async (...args: Parameters<Repository["sync"]>) => {
            if (args[1] === "synced" && !failed) {
              failed = true;
              throw new Error("temporary DB error");
            }
            return target.sync(...args);
          };
        const v = Reflect.get(target, p);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await synchronize(flaky, remote, e, recoveryWindow, recoveryStart);
    assert.equal(remote.jobs.size, 1);
    assert.equal(remote.polls, 1);
    assert.equal(
      (await b.get(e.id, user))!.blobId,
      [...remote.jobs.values()][0].blob,
    );
    assert.equal((await b.get(e.id, user))!.status, "synced");
  }
  // No blind legacy replay; new queued legacy pages may obtain a key.
  {
    const e = await make({ status: "uncertain" }),
      remote = new DeduplicatingRelayer();
    await synchronize(a, remote, e, recoveryWindow, next);
    assert.equal(remote.jobs.size, 0);
    assert.equal(await a.writeIntent(e.id), undefined);
  }
  // Changed destination / payload cannot be submitted using the old key.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer(),
      draft = remote.prepare(e);
    const lease = (await a.claim(e.id, draft, recoveryWindow, recoveryStart))!;
    for (const changed of [
      { ...draft, text: draft.text + " " },
      { ...draft, accountId: "other" },
      { ...draft, namespace: "other" },
      { ...draft, serverUrl: "https://other.invalid" },
    ])
      await assert.rejects(async () =>
        a.claim(e.id, changed, recoveryWindow, next),
      );
    assert.deepEqual((await b.writeIntent(e.id))!.intent, lease.intent);
    // After a new lease, stale worker cannot save a failure or acceptance.
    const newer = (await b.claim(e.id, draft, recoveryWindow, next))!;
    assert.equal(
      await a.sync(e.id, "pending", "stale", null, null, lease.token),
      false,
    );
    assert.equal(
      await a.sync(e.id, "uncertain", null, null, "stale", lease.token),
      false,
    );
    assert.equal((await a.writeIntent(e.id))!.token, newer.token);
  }
  // Unique revisions/users; don't send an unaccepted retired revision on recovery.
  {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    const old = (await a.claim(
      e.id,
      remote.prepare(e),
      recoveryWindow,
      recoveryStart,
    ))!;
    const revised = await make({
      supersedes: e.id,
      rootId: e.rootId,
      revision: 2,
    });
    const unrelated = await make({ userId: other });
    await synchronize(b, remote, e, recoveryWindow, next);
    assert.equal(remote.jobs.size, 0);
    await synchronize(a, remote, revised, recoveryWindow, next);
    await synchronize(b, remote, unrelated, recoveryWindow, next);
    assert.equal(
      new Set([
        old.intent.key,
        (await a.writeIntent(revised.id))!.intent.key,
        (await a.writeIntent(unrelated.id))!.intent.key,
      ]).size,
      3,
    );
    assert.equal(remote.jobs.size, 2);
  }
  // Default off, window expiry, bounded attempts, clock rollback.
  for (const mode of ["disabled", "expired", "exhausted", "clock-rollback"]) {
    const e = await make(),
      remote = new DeduplicatingRelayer();
    remote.loseResponse = true;
    await synchronize(a, remote, e, recoveryWindow, recoveryStart);
    let now = next,
      window = recoveryWindow;
    if (mode === "disabled") window = 0;
    if (mode === "expired") now = recoveryStart + recoveryWindow;
    if (mode === "clock-rollback") now = recoveryStart - 1;
    if (mode === "exhausted") {
      await synchronize(b, remote, e, window, next);
      await synchronize(a, remote, e, window, next + WRITE_LEASE_MS + 1);
      now = next + 2 * WRITE_LEASE_MS + 2;
    }
    const submissions = remote.submissions;
    await synchronize(b, remote, e, window, now);
    assert.equal(remote.submissions, submissions, mode);
    assert.equal(remote.jobs.size, 1, mode);
    assert.equal((await b.get(e.id, user))!.status, "uncertain");
    assert.ok(
      !(await b.pending(user, window, now)).some((row) => row.id === e.id),
      mode,
    );
  }
}
