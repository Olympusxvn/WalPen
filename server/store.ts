import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Repository, UserRecord, WalletChallenge } from "./repository.ts";
import { encryptPayload, decryptPayload } from "./encryption.ts";

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
      CREATE INDEX IF NOT EXISTS entries_user ON entries(userId, retired, createdAt);`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS wallets(address TEXT PRIMARY KEY, userId TEXT UNIQUE NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS wallet_challenges(id TEXT PRIMARY KEY,address TEXT NOT NULL,message TEXT NOT NULL,browserHash TEXT NOT NULL,expires INTEGER NOT NULL,userId TEXT);`);
    this.db.exec(
      "UPDATE entries SET status='uncertain', error='Tiến trình trước đã dừng trong khi gửi. Hãy đối soát trước khi thử lại.' WHERE status='submitting'",
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
  claim(id: string) {
    return (
      Number(
        this.db
          .prepare(
            "UPDATE entries SET status='submitting' WHERE id=? AND status='queued' AND jobId IS NULL",
          )
          .run(id).changes,
      ) === 1
    );
  }
  pending(userId?: string): Entry[] {
    return this.db
      .prepare("SELECT * FROM entries WHERE status IN ('queued','pending')")
      .all()
      .map((r) => this.decode(r))
      .filter((entry) => !userId || entry.userId === userId);
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
  ) {
    this.db
      .prepare(
        "UPDATE entries SET status=?,jobId=?,blobId=?,error=? WHERE id=?",
      )
      .run(status, jobId, blobId, error, id);
  }
}
