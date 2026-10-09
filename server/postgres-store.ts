import { Pool } from "pg";
import type { Entry } from "./store.ts";
import type {
  Repository,
  TelegramInboundJob,
  TelegramLinkResult,
  TelegramLinkStatus,
  UserRecord,
  WalletChallenge,
} from "./repository.ts";
import { encryptPayload, decryptPayload } from "./encryption.ts";
import {
  decodeLease,
  nextLease,
  writeUncertain,
  type WriteDraft,
} from "./write-intent.ts";

/** Persistent cloud state; journal payloads use the same encryption as local SQLite. */

function normalizeTelegramInbound(
  input: TelegramInboundJob,
): TelegramInboundJob {
  if (!input || !Number.isSafeInteger(input.updateId) || input.updateId < 0)
    throw new Error("Invalid Telegram update");
  const telegramId = String(input.telegramId ?? "").trim();
  const chatId = String(input.chatId ?? "").trim();
  const text = typeof input.text === "string" ? input.text : "";
  if (
    !/^\d{1,24}$/.test(telegramId) ||
    !/^-?\d{1,24}$/.test(chatId) ||
    !text.trim() ||
    text.length > 4096 ||
    (input.language !== "en" && input.language !== "vi")
  )
    throw new Error("Invalid Telegram update");
  return {
    updateId: input.updateId,
    telegramId,
    chatId,
    text,
    language: input.language,
  };
}
function telegramSafeErrorCode(value: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "processing_error";
}

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
      CREATE TABLE IF NOT EXISTS telegram_links(telegram_id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), linked_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_link_codes(code_hash TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
      CREATE INDEX IF NOT EXISTS telegram_link_codes_cooldown ON telegram_link_codes(telegram_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS telegram_updates(update_id BIGINT PRIMARY KEY, payload_ciphertext TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','processing','done','failed','uncertain')), attempts INTEGER NOT NULL DEFAULT 0, available_at BIGINT NOT NULL, lease_until BIGINT, completed_at BIGINT, entry_id TEXT UNIQUE REFERENCES entries(id), safe_error_code TEXT);
      CREATE INDEX IF NOT EXISTS telegram_updates_ready ON telegram_updates(state, available_at, lease_until);
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

  async issueTelegramLinkCode(input: {
    telegramId: string;
    codeHash: string;
    createdAt: number;
    expiresAt: number;
  }): Promise<boolean> {
    const telegramId = String(input.telegramId ?? "").trim();
    const codeHash = String(input.codeHash ?? "").trim();
    if (
      !/^\d{1,24}$/.test(telegramId) ||
      !codeHash ||
      codeHash.length > 128 ||
      !Number.isFinite(input.createdAt) ||
      !Number.isFinite(input.expiresAt) ||
      input.expiresAt <= input.createdAt
    )
      throw new Error("Invalid Telegram link code");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),741)", [
        telegramId,
      ]);
      await client.query(
        "DELETE FROM telegram_link_codes WHERE expires_at<=$1",
        [input.createdAt],
      );
      const recent = (
        await client.query(
          "SELECT created_at FROM telegram_link_codes WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 1",
          [telegramId],
        )
      ).rows[0] as { created_at: string | number } | undefined;
      if (recent && input.createdAt - Number(recent.created_at) < 60_000) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        "INSERT INTO telegram_link_codes(code_hash,telegram_id,created_at,expires_at) VALUES($1,$2,$3,$4)",
        [codeHash, telegramId, input.createdAt, input.expiresAt],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async telegramUserId(telegramId: string): Promise<string | undefined> {
    return (
      await this.pool.query(
        "SELECT user_id FROM telegram_links WHERE telegram_id=$1",
        [String(telegramId).trim()],
      )
    ).rows[0]?.user_id;
  }
  async telegramLinkForUser(
    userId: string,
  ): Promise<TelegramLinkStatus | undefined> {
    const row = (
      await this.pool.query(
        "SELECT telegram_id,linked_at FROM telegram_links WHERE user_id=$1",
        [userId],
      )
    ).rows[0] as
      { telegram_id: string; linked_at: string | number } | undefined;
    return row
      ? {
          telegramId: row.telegram_id,
          linkedAt: new Date(Number(row.linked_at)).toISOString(),
        }
      : undefined;
  }
  async consumeTelegramLinkCode(
    codeHash: string,
    userId: string,
    now: number,
  ): Promise<TelegramLinkResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const code = (
        await client.query(
          "SELECT telegram_id,expires_at FROM telegram_link_codes WHERE code_hash=$1 FOR UPDATE",
          [codeHash],
        )
      ).rows[0] as
        { telegram_id: string; expires_at: string | number } | undefined;
      if (!code) {
        await client.query("COMMIT");
        return "invalid";
      }
      await client.query("DELETE FROM telegram_link_codes WHERE code_hash=$1", [
        codeHash,
      ]);
      if (Number(code.expires_at) <= now) {
        await client.query("COMMIT");
        return "expired";
      }
      const result = await client.query(
        "INSERT INTO telegram_links(telegram_id,user_id,linked_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING telegram_id",
        [code.telegram_id, userId, now],
      );
      await client.query("COMMIT");
      return result.rowCount === 1 ? "linked" : "conflict";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async enqueueTelegramUpdate(
    input: TelegramInboundJob,
    now: number,
  ): Promise<{
    created: boolean;
    state: "queued" | "processing" | "done" | "failed" | "uncertain";
  }> {
    const job = normalizeTelegramInbound(input);
    const inserted = await this.pool.query(
      "INSERT INTO telegram_updates(update_id,payload_ciphertext,state,attempts,available_at) VALUES($1,$2,'queued',0,$3) ON CONFLICT(update_id) DO NOTHING RETURNING state",
      [job.updateId, encryptPayload(this.key, job), now],
    );
    if (inserted.rowCount === 1) return { created: true, state: "queued" };
    const existing = (
      await this.pool.query(
        "SELECT state FROM telegram_updates WHERE update_id=$1",
        [job.updateId],
      )
    ).rows[0];
    return { created: false, state: existing.state };
  }
  async pendingTelegramUpdateIds(
    now: number,
    limit: number,
  ): Promise<number[]> {
    const boundedLimit = Math.max(0, Math.min(50, Math.trunc(limit)));
    if (boundedLimit === 0) return [];
    const rows = (
      await this.pool.query(
        "SELECT update_id FROM telegram_updates WHERE (state='queued' AND available_at<=$1) OR (state='processing' AND lease_until<=$1) ORDER BY available_at,update_id LIMIT $2",
        [now, boundedLimit],
      )
    ).rows as { update_id: string | number }[];
    return rows.map((row) => Number(row.update_id));
  }
  async claimTelegramUpdate(
    updateId: number,
    now: number,
    leaseUntil: number,
  ): Promise<TelegramInboundJob | undefined> {
    const result = await this.pool.query(
      "UPDATE telegram_updates SET state='processing',attempts=attempts+1,lease_until=$3,completed_at=NULL,safe_error_code=NULL WHERE update_id=$1 AND ((state='queued' AND available_at<=$2) OR (state='processing' AND lease_until<=$2)) RETURNING payload_ciphertext",
      [updateId, now, leaseUntil],
    );
    return result.rows[0]
      ? (decryptPayload(
          this.key,
          result.rows[0].payload_ciphertext,
        ) as TelegramInboundJob)
      : undefined;
  }
  async finishTelegramUpdate(
    updateId: number,
    status: "done" | "failed" | "uncertain",
    now: number,
    safeErrorCode?: string,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE telegram_updates SET state=$2,lease_until=NULL,completed_at=$3,safe_error_code=$4 WHERE update_id=$1 AND state='processing'",
      [
        updateId,
        status,
        now,
        safeErrorCode ? telegramSafeErrorCode(safeErrorCode) : null,
      ],
    );
  }
  async releaseTelegramUpdate(
    updateId: number,
    nextAttemptAt: number,
    safeErrorCode: string,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE telegram_updates SET state='queued',available_at=$2,lease_until=NULL,safe_error_code=$3 WHERE update_id=$1 AND state='processing'",
      [updateId, nextAttemptAt, telegramSafeErrorCode(safeErrorCode)],
    );
  }
  async insertTelegramEntry(
    updateId: number,
    entry: Entry,
  ): Promise<{ entry: Entry; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const job = (
        await client.query(
          "SELECT state,entry_id FROM telegram_updates WHERE update_id=$1 FOR UPDATE",
          [updateId],
        )
      ).rows[0] as { state: string; entry_id: string | null } | undefined;
      if (!job) throw new Error("Telegram update does not exist");
      if (job.entry_id) {
        const row = (
          await client.query("SELECT * FROM entries WHERE id=$1", [
            job.entry_id,
          ])
        ).rows[0];
        if (!row) throw new Error("Telegram entry association is missing");
        const saved = this.decode(row);
        await client.query("COMMIT");
        return { entry: saved, created: false };
      }
      if (job.state !== "processing")
        throw new Error("Telegram update is not being processed");
      if (entry.supersedes) {
        const changed = await client.query(
          'UPDATE entries SET retired=1 WHERE id=$1 AND "userId"=$2 AND retired=0 RETURNING id',
          [entry.supersedes, entry.userId],
        );
        if (changed.rowCount !== 1)
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
      await client.query(
        "UPDATE telegram_updates SET entry_id=$2 WHERE update_id=$1",
        [updateId, entry.id],
      );
      await client.query("COMMIT");
      return { entry, created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
