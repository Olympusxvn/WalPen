import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { PostgresStore } from "../server/postgres-store.ts";
import { createApp } from "../server/app.ts";
import type { Entry } from "../server/store.ts";

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
    const memory = {
      configured: false,
      remember: async () => "job",
      wait: async () => "blob",
      recall: async () => [],
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
      (await Promise.all([first.claim(id), second.claim(id)])).sort(),
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
    await first.claim(active.id);
    await pool.query('UPDATE entries SET "syncStartedAt"=0 WHERE id=$1', [
      active.id,
    ]);
    assert.equal((await first.pending(userId)).length, 0);
    assert.equal((await first.get(active.id, userId))?.status, "uncertain");
    await request(app2)
      .post("/api/logout")
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    await request(app1).get("/api/entries").set("Cookie", cookie).expect(401);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
