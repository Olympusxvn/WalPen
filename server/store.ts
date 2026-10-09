import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

function normalizeTelegramInbound(
  input: TelegramInboundJob,
): TelegramInboundJob {
  if (!input || !Number.isSafeInteger(input.updateId) || input.updateId < 0)
    throw new Error("Invalid Telegram update");
  const telegramId = String(input.telegramId ?? "").trim();
  const chatId = String(input.chatId ?? "").trim();
  const text = typeof input.text === "string" ? input.text : "";
  if (!/^\d{1,24}$/.test(telegramId) || !/^-?\d{1,24}$/.test(chatId))
    throw new Error("Invalid Telegram update");
  if (!text.trim() || text.length > 4096)
    throw new Error("Invalid Telegram update");
  if (input.language !== "en" && input.language !== "vi")
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

export interface Entry {
  id: string;
  userId: string;
  rootId: string;
  revision: number;
  supersedes: string | null;
  title: string;
  body: string;
  memory: string;
  mood: string;
  consent: boolean;
  createdAt: string;
  occurredAt: string;
  status: string;
  jobId: string | null;
  blobId: string | null;
  error: string | null;
  retired: boolean;
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class Store implements Repository {
  db: DatabaseSync;
  constructor(
    path: string,
    private key: Buffer,
  ) {
    if (key.length !== 32)
      throw new Error("DATA_ENCRYPTION_KEY must contain 32 bytes");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), rootId TEXT NOT NULL, revision INTEGER NOT NULL, supersedes TEXT, payload TEXT NOT NULL, createdAt TEXT NOT NULL, status TEXT NOT NULL, jobId TEXT, blobId TEXT, error TEXT, retired INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS entries_user ON entries(userId, retired, createdAt);
      CREATE TABLE IF NOT EXISTS write_intents(entryId TEXT PRIMARY KEY REFERENCES entries(id), idempotencyKey TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL, firstAttemptAt INTEGER NOT NULL, leaseToken TEXT NOT NULL, leaseUntil INTEGER NOT NULL, nextAttemptAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_links(telegram_id TEXT PRIMARY KEY, user_id TEXT UNIQUE NOT NULL REFERENCES users(id), linked_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_link_codes(code_hash TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS telegram_link_codes_cooldown ON telegram_link_codes(telegram_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS telegram_updates(update_id INTEGER PRIMARY KEY, payload_ciphertext TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','processing','done','failed','uncertain')), attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, lease_until INTEGER, completed_at INTEGER, entry_id TEXT UNIQUE REFERENCES entries(id), safe_error_code TEXT);
      CREATE INDEX IF NOT EXISTS telegram_updates_ready ON telegram_updates(state, available_at, lease_until);`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS wallets(address TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS wallet_challenges(id TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,browserHash TEXT NOT NULL,expires INTEGER NOT NULL,userId TEXT);`);
    this.db.exec(
      "UPDATE entries SET status='uncertain', error='Tiến trình trước đã dừng trong khi gửi. Hãy đối soát trước khi thử lại.' WHERE status='submitting' AND NOT EXISTS (SELECT 1 FROM write_intents WHERE entryId=entries.id)",
    );
  }
  encrypt(value: unknown) {
    return encryptPayload(this.key, value);
  }
  decrypt(value: string) {
    return decryptPayload(this.key, value);
  }
  decode(row: any): Entry {
    const { payload, ...rest } = row;
    return { ...rest, ...this.decrypt(payload), retired: !!rest.retired };
  }
  get(id: string, userId: string): Entry | undefined {
    const r = this.db
      .prepare("SELECT * FROM entries WHERE id=? AND userId=?")
      .get(id, userId);
    return r ? this.decode(r) : undefined;
  }
  list(userId: string, all = false): Entry[] {
    return this.db
      .prepare(
        `SELECT * FROM entries WHERE userId=? ${all ? "" : "AND retired=0"} ORDER BY createdAt DESC`,
      )
      .all(userId)
      .map((r) => this.decode(r));
  }
  session(token: string, now: number) {
    return this.db
      .prepare(
        "SELECT users.id,users.username,wallets.address AS walletAddress FROM sessions JOIN users ON users.id=sessions.userId LEFT JOIN wallets ON wallets.userId=users.id WHERE sessions.token=? AND sessions.expires>?",
      )
      .get(token, now) as { id: string; username: string } | undefined;
  }
  addWalletChallenge(challenge: WalletChallenge) {
    this.db
      .prepare("DELETE FROM wallet_challenges WHERE expires<?")
      .run(Date.now());
    this.db
      .prepare("INSERT INTO wallet_challenges VALUES(?,?,?,?,?,?)")
      .run(
        challenge.id,
        challenge.address,
        challenge.message,
        challenge.browserHash,
        challenge.expires,
        challenge.userId,
      );
  }
  getWalletChallenge(id: string, browserHash: string, now: number) {
    return this.db
      .prepare(
        "SELECT * FROM wallet_challenges WHERE id=? AND browserHash=? AND expires>?",
      )
      .get(id, browserHash, now) as WalletChallenge | undefined;
  }
  consumeWalletChallenge(id: string, browserHash: string, now: number) {
    return (
      Number(
        this.db
          .prepare(
            "DELETE FROM wallet_challenges WHERE id=? AND browserHash=? AND expires>?",
          )
          .run(id, browserHash, now).changes,
      ) === 1
    );
  }
  walletUser(address: string) {
    return this.db
      .prepare(
        "SELECT users.* FROM users JOIN wallets ON wallets.userId=users.id WHERE wallets.address=?",
      )
      .get(address) as UserRecord | undefined;
  }
  bindWallet(address: string, user: UserRecord, create: boolean) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (create) this.addUser(user);
      this.db.prepare("INSERT INTO wallets VALUES(?,?)").run(address, user.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  addSession(token: string, userId: string, expires: number) {
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(token, userId, expires);
  }
  deleteSession(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  }
  userByName(username: string) {
    return this.db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(username) as UserRecord | undefined;
  }
  addUser(user: UserRecord) {
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?,?)")
      .run(user.id, user.username, user.password, user.createdAt);
  }

  issueTelegramLinkCode(input: {
    telegramId: string;
    codeHash: string;
    createdAt: number;
    expiresAt: number;
  }): boolean {
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM telegram_link_codes WHERE expires_at<=?")
        .run(input.createdAt);
      const recent = this.db
        .prepare(
          "SELECT created_at FROM telegram_link_codes WHERE telegram_id=? ORDER BY created_at DESC LIMIT 1",
        )
        .get(telegramId) as { created_at: number } | undefined;
      if (recent && input.createdAt - Number(recent.created_at) < 60_000) {
        this.db.exec("COMMIT");
        return false;
      }
      this.db
        .prepare(
          "INSERT INTO telegram_link_codes(code_hash,telegram_id,created_at,expires_at) VALUES(?,?,?,?)",
        )
        .run(codeHash, telegramId, input.createdAt, input.expiresAt);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  telegramUserId(telegramId: string): string | undefined {
    const row = this.db
      .prepare("SELECT user_id FROM telegram_links WHERE telegram_id=?")
      .get(String(telegramId).trim()) as { user_id: string } | undefined;
    return row?.user_id;
  }
  telegramLinkForUser(userId: string): TelegramLinkStatus | undefined {
    const row = this.db
      .prepare(
        "SELECT telegram_id,linked_at FROM telegram_links WHERE user_id=?",
      )
      .get(userId) as { telegram_id: string; linked_at: number } | undefined;
    return row
      ? {
          telegramId: row.telegram_id,
          linkedAt: new Date(Number(row.linked_at)).toISOString(),
        }
      : undefined;
  }
  consumeTelegramLinkCode(
    codeHash: string,
    userId: string,
    now: number,
  ): TelegramLinkResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const code = this.db
        .prepare(
          "SELECT telegram_id,expires_at FROM telegram_link_codes WHERE code_hash=?",
        )
        .get(codeHash) as
        { telegram_id: string; expires_at: number } | undefined;
      if (!code) {
        this.db.exec("COMMIT");
        return "invalid";
      }
      this.db
        .prepare("DELETE FROM telegram_link_codes WHERE code_hash=?")
        .run(codeHash);
      if (Number(code.expires_at) <= now) {
        this.db.exec("COMMIT");
        return "expired";
      }
      const existing = this.db
        .prepare(
          "SELECT telegram_id,user_id FROM telegram_links WHERE telegram_id=? OR user_id=?",
        )
        .get(code.telegram_id, userId) as
        { telegram_id: string; user_id: string } | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return "conflict";
      }
      this.db
        .prepare(
          "INSERT INTO telegram_links(telegram_id,user_id,linked_at) VALUES(?,?,?)",
        )
        .run(code.telegram_id, userId, now);
      this.db.exec("COMMIT");
      return "linked";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  enqueueTelegramUpdate(
    input: TelegramInboundJob,
    now: number,
  ): {
    created: boolean;
    state: "queued" | "processing" | "done" | "failed" | "uncertain";
  } {
    const job = normalizeTelegramInbound(input);
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO telegram_updates(update_id,payload_ciphertext,state,attempts,available_at) VALUES(?,?, 'queued',0,?)",
      )
      .run(job.updateId, this.encrypt(job), now);
    const row = this.db
      .prepare("SELECT state FROM telegram_updates WHERE update_id=?")
      .get(job.updateId) as {
      state: "queued" | "processing" | "done" | "failed" | "uncertain";
    };
    return { created: Number(inserted.changes) === 1, state: row.state };
  }
  claimTelegramUpdate(
    updateId: number,
    now: number,
    leaseUntil: number,
  ): TelegramInboundJob | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare(
          "SELECT payload_ciphertext FROM telegram_updates WHERE update_id=? AND ((state='queued' AND available_at<=?) OR (state='processing' AND lease_until<=?))",
        )
        .get(updateId, now, now) as { payload_ciphertext: string } | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db
        .prepare(
          "UPDATE telegram_updates SET state='processing',attempts=attempts+1,lease_until=?,completed_at=NULL WHERE update_id=?",
        )
        .run(leaseUntil, updateId);
      const job = this.decrypt(row.payload_ciphertext) as TelegramInboundJob;
      this.db.exec("COMMIT");
      return job;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  finishTelegramUpdate(
    updateId: number,
    status: "done" | "failed" | "uncertain",
    now: number,
    safeErrorCode?: string,
  ): void {
    this.db
      .prepare(
        "UPDATE telegram_updates SET state=?,lease_until=NULL,completed_at=?,safe_error_code=? WHERE update_id=? AND state='processing'",
      )
      .run(
        status,
        now,
        safeErrorCode ? telegramSafeErrorCode(safeErrorCode) : null,
        updateId,
      );
  }
  releaseTelegramUpdate(
    updateId: number,
    nextAttemptAt: number,
    safeErrorCode: string,
  ): void {
    this.db
      .prepare(
        "UPDATE telegram_updates SET state='queued',available_at=?,lease_until=NULL,safe_error_code=? WHERE update_id=? AND state='processing'",
      )
      .run(nextAttemptAt, telegramSafeErrorCode(safeErrorCode), updateId);
  }
  insertTelegramEntry(
    updateId: number,
    entry: Entry,
  ): { entry: Entry; created: boolean } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const job = this.db
        .prepare(
          "SELECT state,entry_id FROM telegram_updates WHERE update_id=?",
        )
        .get(updateId) as
        { state: string; entry_id: string | null } | undefined;
      if (!job) throw new Error("Telegram update does not exist");
      if (job.entry_id) {
        const row = this.db
          .prepare("SELECT * FROM entries WHERE id=?")
          .get(job.entry_id);
        if (!row) throw new Error("Telegram entry association is missing");
        const saved = this.decode(row);
        this.db.exec("COMMIT");
        return { entry: saved, created: false };
      }
      if (job.state !== "processing")
        throw new Error("Telegram update is not being processed");
      if (entry.supersedes) {
        const changed = this.db
          .prepare(
            "UPDATE entries SET retired=1 WHERE id=? AND userId=? AND retired=0",
          )
          .run(entry.supersedes, entry.userId);
        if (Number(changed.changes) !== 1)
          throw new Error("Entry has already changed. Reload and try again.");
      }
      this.db
        .prepare(
          "INSERT INTO entries(id,userId,rootId,revision,supersedes,payload,createdAt,status,jobId,blobId,error,retired) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          entry.id,
          entry.userId,
          entry.rootId,
          entry.revision,
          entry.supersedes,
          this.encrypt({
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
        );
      this.db
        .prepare("UPDATE telegram_updates SET entry_id=? WHERE update_id=?")
        .run(entry.id, updateId);
      this.db.exec("COMMIT");
      return { entry, created: true };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  writeIntent(id: string) {
    return decodeLease(
      this.db.prepare("SELECT * FROM write_intents WHERE entryId=?").get(id),
      (p) => this.decrypt(p),
    );
  }
  claim(id: string, draft: WriteDraft, windowMs: number, now: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT * FROM entries WHERE id=?").get(id);
      const lease =
        row &&
        nextLease(this.decode(row), this.writeIntent(id), draft, windowMs, now);
      if (lease) {
        this.db
          .prepare(
            `INSERT INTO write_intents VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(entryId) DO UPDATE SET attempts=excluded.attempts, leaseToken=excluded.leaseToken, leaseUntil=excluded.leaseUntil, nextAttemptAt=excluded.nextAttemptAt`,
          )
          .run(
            id,
            lease.intent.key,
            this.encrypt(lease.intent),
            lease.attempts,
            lease.firstAttemptAt,
            lease.token,
            lease.leaseUntil,
            lease.nextAttemptAt,
          );
        this.db
          .prepare(
            "UPDATE entries SET status='submitting',error=NULL WHERE id=?",
          )
          .run(id);
      }
      this.db.exec("COMMIT");
      return lease;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  pending(userId?: string, windowMs = 0, now = Date.now()): Entry[] {
    this.db
      .prepare(
        `UPDATE entries SET status='uncertain',error=? WHERE status='submitting' AND EXISTS (SELECT 1 FROM write_intents w WHERE w.entryId=entries.id AND w.leaseUntil<=?)`,
      )
      .run(writeUncertain, now);
    return this.db
      .prepare(
        `SELECT e.* FROM entries e LEFT JOIN write_intents w ON w.entryId=e.id WHERE (? IS NULL OR e.userId=?) AND ((e.jobId IS NOT NULL AND e.status IN ('pending','uncertain','submitting')) OR (e.retired=0 AND e.jobId IS NULL AND ((e.status='queued' AND w.entryId IS NULL) OR (e.status IN ('queued','uncertain','submitting') AND ?>0 AND w.attempts<3 AND w.firstAttemptAt<=? AND w.firstAttemptAt+?>? AND w.leaseUntil<=? AND w.nextAttemptAt<=?)))) ORDER BY e.createdAt LIMIT 20`,
      )
      .all(
        userId ?? null,
        userId ?? null,
        windowMs,
        now,
        windowMs,
        now,
        now,
        now,
      )
      .map((r) => this.decode(r));
  }
  insert(e: Entry) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (e.supersedes) {
        const changed = this.db
          .prepare(
            "UPDATE entries SET retired=1 WHERE id=? AND userId=? AND retired=0",
          )
          .run(e.supersedes, e.userId);
        if (Number(changed.changes) !== 1)
          throw new Error("Entry has already changed. Reload and try again.");
      }
      this.db
        .prepare(
          "INSERT INTO entries(id,userId,rootId,revision,supersedes,payload,createdAt,status,jobId,blobId,error,retired) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          e.id,
          e.userId,
          e.rootId,
          e.revision,
          e.supersedes,
          this.encrypt({
            title: e.title,
            body: e.body,
            memory: e.memory,
            mood: e.mood,
            consent: e.consent,
            occurredAt: e.occurredAt,
          }),
          e.createdAt,
          e.status,
          e.jobId,
          e.blobId,
          e.error,
          e.retired ? 1 : 0,
        );
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  sync(
    id: string,
    status: string,
    jobId: string | null,
    blobId: string | null,
    error: string | null,
    leaseToken?: string,
  ) {
    return (
      Number(
        this.db
          .prepare(
            `UPDATE entries SET status=?,jobId=COALESCE(jobId,?),blobId=COALESCE(blobId,?),error=? WHERE id=? AND status!='synced' AND (status!='failed' OR ?='synced') AND (jobId IS NULL OR jobId=?) AND (? IS NULL OR EXISTS (SELECT 1 FROM write_intents w WHERE w.entryId=entries.id AND w.leaseToken=?))`,
          )
          .run(
            status,
            jobId,
            blobId,
            error,
            id,
            status,
            jobId,
            leaseToken ?? null,
            leaseToken ?? null,
          ).changes,
      ) === 1
    );
  }
}
