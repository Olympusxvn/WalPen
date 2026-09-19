import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
mkdirSync("data/backups", { recursive: true });
const file = resolve(
  "data/backups",
  `walpen-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
);
const db = new DatabaseSync(process.env.DATABASE_PATH || "data/walpen.sqlite");
db.prepare("VACUUM INTO ?").run(file);
db.close();
console.log(`Consistent encrypted database snapshot: ${file}`);
console.log(
  "Keep DATA_ENCRYPTION_KEY in a separate secure backup. Do not upload either file.",
);
