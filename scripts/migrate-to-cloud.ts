import "dotenv/config";
import { parse } from "dotenv";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { PostgresStore } from "../server/postgres-store.ts";
import { decryptPayload } from "../server/encryption.ts";

// Explicit operator command. Nothing invokes this during normal startup/deployment.
const cloud = parse(readFileSync("data/cloud-production.env"));
const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY || "", "hex");
if (!cloud.DATABASE_URL || key.length !== 32)
  throw new Error("Cloud settings or original encryption key are missing.");
mkdirSync("data/backups", { recursive: true });
const snapshot = resolve("data/backups", `before-cloud-${Date.now()}.sqlite`);
const source = new DatabaseSync(
  process.env.DATABASE_PATH || "data/walpen.sqlite",
  { readOnly: true },
);
source.prepare("VACUUM INTO ?").run(snapshot);
source.close();
const copy = new DatabaseSync(snapshot, { readOnly: true });
const pool = new Pool({
  connectionString: cloud.DATABASE_URL_UNPOOLED || cloud.DATABASE_URL,
  max: 1,
});
const store = new PostgresStore(pool, key);
try {
  await store.init();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "LOCK TABLE users,sessions,entries,write_intents IN ACCESS EXCLUSIVE MODE",
    );
    const existing = (
      await client.query("SELECT COUNT(*)::int AS count FROM users")
    ).rows[0].count;
    if (existing)
      throw new Error(
        "Destination has users. Migration refuses to overwrite an existing cloud database.",
      );
    const users = copy.prepare("SELECT * FROM users").all() as any[];
    const sessions = copy
      .prepare("SELECT * FROM sessions WHERE expires>?")
      .all(Date.now()) as any[];
    const entries = copy.prepare("SELECT * FROM entries").all() as any[];
    const hasIntents = copy
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='write_intents'",
      )
      .get();
    const intents = hasIntents
      ? (copy.prepare("SELECT * FROM write_intents").all() as any[])
      : [];
    for (const user of users)
      await client.query(
        'INSERT INTO users(id,username,password,"createdAt") VALUES($1,$2,$3,$4)',
        [user.id, user.username, user.password, user.createdAt],
      );
    for (const session of sessions)
      await client.query(
        'INSERT INTO sessions(token,"userId",expires) VALUES($1,$2,$3)',
        [session.token, session.userId, session.expires],
      );
    for (const entry of entries) {
      decryptPayload(key, entry.payload); // Verify every ciphertext before committing.
      await client.query(
        'INSERT INTO entries(id,"userId","rootId",revision,supersedes,payload,"createdAt",status,"jobId","blobId",error,retired) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          entry.id,
          entry.userId,
          entry.rootId,
          entry.revision,
          entry.supersedes,
          entry.payload,
          entry.createdAt,
          entry.status === "submitting" ? "uncertain" : entry.status,
          entry.jobId,
          entry.blobId,
          entry.error,
          entry.retired,
        ],
      );
    }
    for (const intent of intents) {
      decryptPayload(key, intent.payload);
      await client.query(
        'INSERT INTO write_intents("entryId","idempotencyKey",payload,attempts,"firstAttemptAt","leaseToken","leaseUntil","nextAttemptAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          intent.entryId,
          intent.idempotencyKey,
          intent.payload,
          intent.attempts,
          intent.firstAttemptAt,
          intent.leaseToken,
          intent.leaseUntil,
          intent.nextAttemptAt,
        ],
      );
    }
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        users: users.length,
        sessions: sessions.length,
        entries: entries.length,
        writeIntents: intents.length,
        snapshot,
        preserved:
          "IDs, namespaces, password hashes, ciphertext, consent, revisions, Walrus receipts and write intents with original retry deadlines",
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  copy.close();
  await pool.end();
}
