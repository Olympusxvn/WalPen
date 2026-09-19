import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const secrets = [
  "MEMWAL_PRIVATE_KEY",
  "DATA_ENCRYPTION_KEY",
  "LLM_API_KEY",
  "E2E_PASSWORD",
]
  .map((n) => process.env[n])
  .filter((s): s is string => !!s && s.length >= 16);
const hits = files.filter((file) => {
  const bytes = readFileSync(file);
  return secrets.some((s) => bytes.includes(Buffer.from(s)));
});
if (hits.length)
  throw new Error(`Secret scan failed in files: ${hits.join(", ")}`);
console.log(
  `Checked ${files.length} source files: no configured secrets found.`,
);
