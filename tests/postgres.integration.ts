import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { PostgresStore } from "../server/postgres-store.ts";
import { createApp } from "../server/app.ts";
import type { Entry } from "../server/store.ts";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { serializeMemory } from "../server/write-intent.ts";
import {
  recoveryScenarios,
  journal,
  DeduplicatingRelayer,
  recoveryWindow,
  recoveryStart,
} from "./recovery-fixtures.ts";
import { synchronize } from "../server/synchronize.ts";

test("cloud repository preserves sessions, encrypted entries and single-submit claims across instances", async () => {
  if (!process.env.WALPEN_TEST_DATABASE_URL)
    throw new Error(
      "Set WALPEN_TEST_DATABASE_URL to a test database. This test uses and removes its own random schema.",
    );
  const connectionString = process.env.WALPEN_TEST_DATABASE_URL;
  const admin = new Pool({ connectionString, max: 1 });
  const schema = `walpen_test_${randomBytes(8).toString("hex")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString,
    max: 3,
    options: `-c search_path=${schema}`,
  });
  const key = randomBytes(32);
  const first = new PostgresStore(pool, key),
    second = new PostgresStore(pool, key);
  try {
    await first.init();
    const telegramOwner = randomUUID();
    await first.addUser({
      id: telegramOwner,
      username: telegramOwner,
      password: "test-only-password",
      createdAt: new Date().toISOString(),
    });
    assert.equal(
      await first.issueTelegramLinkCode({
        telegramId: "600001",
        codeHash: "expired-code-digest",
        createdAt: 1_000_000,
        expiresAt: 1_600_000,
      }),
      true,
    );
    assert.equal(
      await second.issueTelegramLinkCode({
        telegramId: "600001",
        codeHash: "cooldown-code-digest",
        createdAt: 1_059_999,
        expiresAt: 1_659_999,
      }),
      false,
    );
    assert.equal(
      await second.consumeTelegramLinkCode(
        "expired-code-digest",
        telegramOwner,
        1_600_000,
      ),
      "expired",
    );
    assert.equal(
      await first.issueTelegramLinkCode({
        telegramId: "600002",
        codeHash: "valid-code-digest",
        createdAt: 1_700_000,
        expiresAt: 2_300_000,
      }),
      true,
    );
    assert.equal(
      await second.consumeTelegramLinkCode(
        "valid-code-digest",
        telegramOwner,
        1_700_001,
      ),
      "linked",
    );
    assert.equal(await second.telegramUserId("600002"), telegramOwner);
    assert.equal(
      (await first.telegramLinkForUser(telegramOwner))?.telegramId,
      "600002",
    );
    assert.equal(
      await first.issueTelegramLinkCode({
        telegramId: "600003",
        codeHash: "conflict-code-digest",
        createdAt: 1_700_000,
        expiresAt: 2_300_000,
      }),
      true,
    );
    assert.equal(
      await second.consumeTelegramLinkCode(
        "conflict-code-digest",
        telegramOwner,
        1_700_002,
      ),
      "conflict",
    );

    const telegramJob = {
      updateId: 900001,
      telegramId: "600002",
      chatId: "600002",
      text: "private telegram journal must stay encrypted",
      language: "en" as const,
    };
    assert.deepEqual(await first.enqueueTelegramUpdate(telegramJob, 1_000), {
      created: true,
      state: "queued",
    });
    assert.deepEqual(await second.enqueueTelegramUpdate(telegramJob, 1_001), {
      created: false,
      state: "queued",
    });
    const telegramRaw = (
      await pool.query(
        "SELECT payload_ciphertext FROM telegram_updates WHERE update_id=$1",
        [telegramJob.updateId],
      )
    ).rows[0].payload_ciphertext as string;
    assert.ok(!telegramRaw.includes(telegramJob.text));
    assert.deepEqual(await first.pendingTelegramUpdateIds(1_000, 10), [900001]);
    assert.deepEqual(
      await first.claimTelegramUpdate(telegramJob.updateId, 1_001, 361_000),
      telegramJob,
    );
    assert.deepEqual(await second.pendingTelegramUpdateIds(2_000, 10), []);
    assert.equal(
      await second.claimTelegramUpdate(telegramJob.updateId, 2_000, 362_000),
      undefined,
    );
    assert.deepEqual(
      await second.claimTelegramUpdate(telegramJob.updateId, 361_000, 721_000),
      telegramJob,
    );
    assert.deepEqual(await first.pendingTelegramUpdateIds(362_000, 10), []);
    const telegramEntry = journal(telegramOwner);
    const telegramSaved = await first.insertTelegramEntry(
      telegramJob.updateId,
      telegramEntry,
    );
    const telegramReplay = await second.insertTelegramEntry(
      telegramJob.updateId,
      journal(telegramOwner),
    );
    assert.equal(telegramSaved.created, true);
    assert.equal(telegramReplay.created, false);
    assert.equal(telegramReplay.entry.id, telegramEntry.id);
    const telegramEntryRaw = (
      await pool.query("SELECT payload FROM entries WHERE id=$1", [
        telegramEntry.id,
      ])
    ).rows[0].payload as string;
    assert.ok(!telegramEntryRaw.includes(telegramEntry.body));
    assert.equal(
      (await second.get(telegramEntry.id, telegramOwner))?.body,
      telegramEntry.body,
    );
    await second.finishTelegramUpdate(telegramJob.updateId, "done", 361_001);
    assert.equal(
      await first.claimTelegramUpdate(telegramJob.updateId, 800_000, 1_160_000),
      undefined,
    );
    const memory = {
      configured: false,
      prepare: (e: Entry) => ({
        accountId: "fake",
        serverUrl: "https://fake.invalid",
        namespace: e.userId,
        text: serializeMemory(e),
      }),
      remember: async () => "job",
      wait: async () => "blob",
      recall: async () => ({ results: [] }),
    };
    const model = {
      configured: false,
      name: "none",
      answer: async () => "unused",
    };
    const app1 = createApp(first, memory, model, { rateLimits: false }).app;
    const app2 = createApp(second, memory, model, { rateLimits: false }).app;
    const register = await request(app1)
      .post("/api/register")
      .send({ username: "cloud_judge", password: "test-only-password-123" })
      .expect(201);
    const cookie = register.headers["set-cookie"][0].split(";")[0];
    await request(app2)
      .get("/api/session")
      .set("Cookie", cookie)
      .expect(200)
      .expect((result) =>
        assert.equal(result.body.user.username, "cloud_judge"),
      );
    const saved = await request(app1)
      .post("/api/entries")
      .set("Cookie", cookie)
      .send({
        title: "Cloud test",
        body: "Secret fictional journal",
        memory: "Park walk",
        mood: "🌿",
        consent: true,
        occurredAt: new Date().toISOString(),
      })
      .expect(202);
    const id = saved.body.entry.id,
      userId = register.body.user.id;
    const raw = (
      await pool.query("SELECT payload FROM entries WHERE id=$1", [id])
    ).rows[0].payload;
    assert.ok(!raw.includes("Secret fictional journal"));
    assert.equal(
      (await second.get(id, userId))?.body,
      "Secret fictional journal",
    );
    assert.equal(await second.get(id, "another-user"), undefined);
    assert.deepEqual(
      (
        await Promise.all([
          first.claim(
            id,
            memory.prepare((await first.get(id, userId))!),
            0,
            Date.now(),
          ),
          second.claim(
            id,
            memory.prepare((await second.get(id, userId))!),
            0,
            Date.now(),
          ),
        ])
      )
        .map(Boolean)
        .sort(),
      [false, true],
    );
    await first.sync(id, "synced", "job-1", "blob-1", null);
    await second.sync(id, "pending", "job-1", null, "late timeout");
    assert.equal((await second.get(id, userId))?.status, "synced");
    const old = (await first.get(id, userId))!;
    const makeRevision = (): Entry => ({
      ...old,
      id: randomUUID(),
      revision: 2,
      supersedes: id,
      status: "queued",
      jobId: null,
      blobId: null,
      error: null,
    });
    const race = await Promise.allSettled([
      first.insert(makeRevision()),
      second.insert(makeRevision()),
    ]);
    assert.equal(
      race.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal((await first.list(userId)).length, 1);
    const active = (await first.list(userId))[0];
    await first.claim(active.id, memory.prepare(active), 0, Date.now());
    await pool.query(
      'UPDATE write_intents SET "leaseUntil"=0 WHERE "entryId"=$1',
      [active.id],
    );
    assert.equal((await first.pending(userId)).length, 0);
    assert.equal((await first.get(active.id, userId))?.status, "uncertain");
    const wallet = new Ed25519Keypair();
    const challenge = await request(app1)
      .post("/api/wallet/challenge")
      .set("Cookie", cookie)
      .send({ address: wallet.toSuiAddress(), link: true })
      .expect(200);
    const challengeCookie = challenge.headers["set-cookie"][0].split(";")[0];
    const signed = await wallet.signPersonalMessage(
      new TextEncoder().encode(challenge.body.message),
    );
    const walletBody = {
      challengeId: challenge.body.challengeId,
      signature: signed.signature,
    };
    const verified = await request(app2)
      .post("/api/wallet/verify")
      .set("Cookie", `${cookie}; ${challengeCookie}`)
      .send(walletBody)
      .expect(200);
    assert.equal(verified.body.user.id, userId);
    await request(app1)
      .post("/api/wallet/verify")
      .set("Cookie", `${cookie}; ${challengeCookie}`)
      .send(walletBody)
      .expect(401);
    assert.equal((await second.walletUser(wallet.toSuiAddress()))?.id, userId);
    await request(app2)
      .post("/api/logout")
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    await request(app1).get("/api/entries").set("Cookie", cookie).expect(401);
    await recoveryScenarios(first, second);
    // Fail inside the actual PostgreSQL transaction, after locking the entry.
    const fixture = journal(userId);
    await first.insert(fixture);
    const remote = new DeduplicatingRelayer();
    await pool.query(
      `CREATE FUNCTION fail_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$; CREATE TRIGGER fail_intent BEFORE INSERT ON write_intents FOR EACH ROW EXECUTE FUNCTION fail_intent()`,
    );
    await assert.rejects(
      synchronize(first, remote, fixture, recoveryWindow, recoveryStart),
    );
    assert.equal((await second.get(fixture.id, userId))!.status, "queued");
    assert.equal(await second.writeIntent(fixture.id), undefined);
    assert.equal(remote.jobs.size, 0);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
