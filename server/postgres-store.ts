import { Pool } from "pg";
import type { Entry } from "./store.ts";
import type { Repository, UserRecord, WalletChallenge } from "./repository.ts";
import { encryptPayload, decryptPayload } from "./encryption.ts";
import {
  decodeLease,
  nextLease,
  writeUncertain,
  type WriteDraft,
} from "./write-intent.ts";

/** Persistent cloud state; journal payloads use the same encryption as local SQLite. */
export class PostgresStore implements Repository {
  private ready?: Promise<void>;
  constructor(
    public pool: Pool,
    private key: Buffer,
  ) {
    if (key.length !== 32)
      throw new Error("DATA_ENCRYPTION_KEY must contain 32 bytes");
  }
  init(): Promise<void> {
    return (this.ready ??= this.pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, "createdAt" TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES users(id), expires BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES users(id), "rootId" TEXT NOT NULL, revision INTEGER NOT NULL, supersedes TEXT, payload TEXT NOT NULL, "createdAt" TEXT NOT NULL, status TEXT NOT NULL, "jobId" TEXT, "blobId" TEXT, error TEXT, retired INTEGER NOT NULL DEFAULT 0, "syncStartedAt" BIGINT);
      CREATE INDEX IF NOT EXISTS entries_user ON entries("userId", retired, "createdAt");
      CREATE TABLE IF NOT EXISTS write_intents("entryId" TEXT PRIMARY KEY REFERENCES entries(id), "idempotencyKey" TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL, "firstAttemptAt" BIGINT NOT NULL, "leaseToken" TEXT NOT NULL, "leaseUntil" BIGINT NOT NULL, "nextAttemptAt" BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
      CREATE TABLE IF NOT EXISTS wallets(address TEXT PRIMARY KEY, "userId" TEXT UNIQUE NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS wallet_challenges(id TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,"browserHash" TEXT NOT NULL,expires BIGINT NOT NULL,"userId" TEXT);
    `,
      )
      .then(() => undefined)
      .catch((error) => {
        this.ready = undefined;
        throw error;
      }));
  }
  private decode(row: any): Entry {
    const { payload, syncStartedAt: _started, ...rest } = row;
    return {
      ...rest,
      ...decryptPayload(this.key, payload),
      retired: !!rest.retired,
    };
  }
  async session(token: string, now: number) {
    return (
      await this.pool.query(
        'SELECT users.id,users.username,wallets.address AS "walletAddress" FROM sessions JOIN users ON users.id=sessions."userId" LEFT JOIN wallets ON wallets."userId"=users.id WHERE sessions.token=$1 AND sessions.expires>$2',
        [token, now],
      )
    ).rows[0];
  }
  async addWalletChallenge(challenge: WalletChallenge) {
    await this.pool.query("DELETE FROM wallet_challenges WHERE expires<$1", [
      Date.now(),
    ]);
    await this.pool.query(
      "INSERT INTO wallet_challenges VALUES($1,$2,$3,$4,$5,$6)",
      [
        challenge.id,
        challenge.address,
        challenge.message,
        challenge.browserHash,
        challenge.expires,
        challenge.userId,
      ],
    );
  }
  async getWalletChallenge(
    id: string,
    browserHash: string,
    now: number,
  ): Promise<WalletChallenge | undefined> {
    return (
      await this.pool.query(
        'SELECT * FROM wallet_challenges WHERE id=$1 AND "browserHash"=$2 AND expires>$3',
        [id, browserHash, now],
      )
    ).rows[0];
  }
  async consumeWalletChallenge(id: string, browserHash: string, now: number) {
    return (
      (
        await this.pool.query(
          'DELETE FROM wallet_challenges WHERE id=$1 AND "browserHash"=$2 AND expires>$3 RETURNING id',
          [id, browserHash, now],
        )
      ).rowCount === 1
    );
  }
  async walletUser(address: string): Promise<UserRecord | undefined> {
    return (
      await this.pool.query(
        'SELECT users.* FROM users JOIN wallets ON wallets."userId"=users.id WHERE wallets.address=$1',
        [address],
      )
    ).rows[0];
  }
  async bindWallet(address: string, user: UserRecord, create: boolean) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (create)
        await client.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
          user.id,
          user.username,
          user.password,
          user.createdAt,
        ]);
      await client.query("INSERT INTO wallets VALUES($1,$2)", [
        address,
        user.id,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async addSession(token: string, userId: string, expires: number) {
    await this.pool.query(
      'INSERT INTO sessions(token,"userId",expires) VALUES($1,$2,$3)',
      [token, userId, expires],
    );
    await this.pool.query("DELETE FROM sessions WHERE expires<$1", [
      Date.now(),
    ]);
  }
  async deleteSession(token: string) {
    await this.pool.query("DELETE FROM sessions WHERE token=$1", [token]);
  }
  async userByName(username: string): Promise<UserRecord | undefined> {
    return (
      await this.pool.query("SELECT * FROM users WHERE username=$1", [username])
    ).rows[0];
  }
  async addUser(user: UserRecord) {
    await this.pool.query(
      'INSERT INTO users(id,username,password,"createdAt") VALUES($1,$2,$3,$4)',
      [user.id, user.username, user.password, user.createdAt],
    );
  }
  async get(id: string, userId: string): Promise<Entry | undefined> {
    const row = (
      await this.pool.query(
        'SELECT * FROM entries WHERE id=$1 AND "userId"=$2',
        [id, userId],
      )
    ).rows[0];
    return row ? this.decode(row) : undefined;
  }
  async list(userId: string, all = false): Promise<Entry[]> {
    return (
      await this.pool.query(
        `SELECT * FROM entries WHERE "userId"=$1 ${all ? "" : "AND retired=0"} ORDER BY "createdAt" DESC`,
        [userId],
      )
    ).rows.map((row) => this.decode(row));
  }
  async pending(
    userId?: string,
    windowMs = 0,
    now = Date.now(),
  ): Promise<Entry[]> {
    await this.pool.query(
      `UPDATE entries e SET status='uncertain', error=$3 WHERE status='submitting' AND (EXISTS (SELECT 1 FROM write_intents w WHERE w."entryId"=e.id AND w."leaseUntil"<=$1) OR (NOT EXISTS (SELECT 1 FROM write_intents w WHERE w."entryId"=e.id) AND ("syncStartedAt" IS NULL OR "syncStartedAt"<$2)))`,
      [now, now - 10 * 60 * 1000, writeUncertain],
    );
    return (
      await this.pool.query(
        `SELECT e.* FROM entries e LEFT JOIN write_intents w ON w."entryId"=e.id WHERE ($1::text IS NULL OR e."userId"=$1) AND ((e."jobId" IS NOT NULL AND e.status IN ('pending','uncertain','submitting')) OR (e.retired=0 AND e."jobId" IS NULL AND ((e.status='queued' AND w."entryId" IS NULL) OR (e.status IN ('queued','uncertain','submitting') AND $2::bigint>0 AND w.attempts<3 AND w."firstAttemptAt"<=$3 AND w."firstAttemptAt"+$2>$3 AND w."leaseUntil"<=$3 AND w."nextAttemptAt"<=$3)))) ORDER BY e."createdAt" LIMIT 20`,
        [userId ?? null, windowMs, now],
      )
    ).rows.map((row) => this.decode(row));
  }
  async writeIntent(id: string) {
    return decodeLease(
      (
        await this.pool.query(
          'SELECT * FROM write_intents WHERE "entryId"=$1',
          [id],
        )
      ).rows[0],
      (p) => decryptPayload(this.key, p),
    );
  }
  async claim(id: string, draft: WriteDraft, windowMs: number, now: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = (
        await client.query("SELECT * FROM entries WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      const old = decodeLease(
        (
          await client.query('SELECT * FROM write_intents WHERE "entryId"=$1', [
            id,
          ])
        ).rows[0],
        (p) => decryptPayload(this.key, p),
      );
      const lease =
        row && nextLease(this.decode(row), old, draft, windowMs, now);
      if (lease) {
        await client.query(
          `INSERT INTO write_intents VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT("entryId") DO UPDATE SET attempts=EXCLUDED.attempts,"leaseToken"=EXCLUDED."leaseToken","leaseUntil"=EXCLUDED."leaseUntil","nextAttemptAt"=EXCLUDED."nextAttemptAt"`,
          [
            id,
            lease.intent.key,
            encryptPayload(this.key, lease.intent),
            lease.attempts,
            lease.firstAttemptAt,
            lease.token,
            lease.leaseUntil,
            lease.nextAttemptAt,
          ],
        );
        await client.query(
          `UPDATE entries SET status='submitting',error=NULL,"syncStartedAt"=$2 WHERE id=$1`,
          [id, now],
        );
      }
      await client.query("COMMIT");
      return lease;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async insert(entry: Entry) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (entry.supersedes) {
        const result = await client.query(
          'UPDATE entries SET retired=1 WHERE id=$1 AND "userId"=$2 AND retired=0 RETURNING id',
          [entry.supersedes, entry.userId],
        );
        if (result.rowCount !== 1)
          throw new Error("Entry has already changed. Reload and try again.");
      }
      await client.query(
        'INSERT INTO entries(id,"userId","rootId",revision,supersedes,payload,"createdAt",status,"jobId","blobId",error,retired) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          entry.id,
          entry.userId,
          entry.rootId,
          entry.revision,
          entry.supersedes,
          encryptPayload(this.key, {
            title: entry.title,
            body: entry.body,
            memory: entry.memory,
            mood: entry.mood,
            consent: entry.consent,
            occurredAt: entry.occurredAt,
          }),
          entry.createdAt,
          entry.status,
          entry.jobId,
          entry.blobId,
          entry.error,
          entry.retired ? 1 : 0,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async sync(
    id: string,
    status: string,
    jobId: string | null,
    blobId: string | null,
    error: string | null,
    leaseToken?: string,
  ) {
    // Concurrent polls must not downgrade an already confirmed receipt.
    return (
      (
        await this.pool.query(
          `UPDATE entries SET status=$2,"jobId"=COALESCE("jobId",$3),"blobId"=COALESCE("blobId",$4),error=$5 WHERE id=$1 AND status!='synced' AND (status!='failed' OR $2='synced') AND ("jobId" IS NULL OR "jobId"=$3) AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM write_intents w WHERE w."entryId"=entries.id AND w."leaseToken"=$6))`,
          [id, status, jobId, blobId, error, leaseToken ?? null],
        )
      ).rowCount === 1
    );
  }
}
