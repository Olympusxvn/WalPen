import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
const origin = process.env.E2E_BASE_URL || "https://walpen.vercel.app";
const login = await fetch(origin + "/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({
    username: process.env.E2E_USERNAME,
    password: process.env.E2E_PASSWORD,
  }),
});
if (!login.ok) throw new Error(`Login verification failed: ${login.status}`);
const cookie = login.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
const entries = (await fetch(origin + "/api/entries", {
  headers: { Cookie: cookie },
}).then((r) => r.json())) as any;
if (!entries.entries.some((e: any) => e.status === "synced" && e.consent))
  throw new Error("No confirmed approved demo memory.");
const results = [];
for (const trial of [
  {
    language: "en",
    useMemory: false,
    message: "In our fictional demo, what activity helps An feel calm?",
  },
  {
    language: "vi",
    useMemory: true,
    message: "Trong ví dụ giả lập, điều gì giúp An bình tĩnh?",
  },
]) {
  const start = Date.now();
  const response = await fetch(origin + "/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify({ ...trial, history: [] }),
    signal: AbortSignal.timeout(180000),
  });
  const data: any = await response.json();
  results.push({
    ...trial,
    status: response.status,
    elapsedMs: Date.now() - start,
    ...data,
  });
  console.log(
    JSON.stringify({
      language: trial.language,
      status: response.status,
      sources: data.sources?.length,
      elapsedMs: Date.now() - start,
      answer: data.answer,
      error: data.error,
    }),
  );
  if (!response.ok) break;
}
mkdirSync("data/evidence", { recursive: true });
writeFileSync(
  "data/evidence/public-e2e.json",
  JSON.stringify({ origin, at: new Date().toISOString(), results }, null, 2),
);
if (
  results.length !== 2 ||
  results.some((r) => r.status !== 200) ||
  results[0].sources.length !== 0 ||
  /\[\d+\]/.test(results[0].answer) ||
  results[1].sources.length < 1 ||
  results.some(
    (r) =>
      r.answer.length > 1000 ||
      /instruction says|approved memories|let me draft|I need to check|Okay, let's see/i.test(
        r.answer,
      ),
  ) ||
  !/ven sông/i.test(results[1].answer) ||
  !/\[1\]/.test(results[1].answer)
)
  throw new Error("Public memory comparison failed.");
console.log(
  "Verified HTTPS login, persisted journal, concise answers and fresh-session Walrus recall; inspect saved answers for language quality.",
);
