import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
export class Store {
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
    this.db.exec(
      "UPDATE entries SET status='uncertain', error='Tiến trình trước đã dừng trong khi gửi. Hãy đối soát trước khi thử lại.' WHERE status='submitting'",
    );
  }
  encrypt(value: unknown) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
  }
  decrypt(value: string) {
    const b = Buffer.from(value, "base64");
    const d = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(b.subarray(28)), d.final()]).toString(),
    );
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
  pending(): Entry[] {
    return this.db
      .prepare("SELECT * FROM entries WHERE status IN ('queued','pending')")
      .all()
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
  ) {
    this.db
      .prepare(
        "UPDATE entries SET status=?,jobId=?,blobId=?,error=? WHERE id=?",
      )
      .run(status, jobId, blobId, error, id);
  }
}
