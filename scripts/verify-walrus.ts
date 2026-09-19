import "dotenv/config";
import { MemWal } from "@mysten-incubation/memwal";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
const dir = "data/evidence";
mkdirSync(dir, { recursive: true });
const path = `${dir}/walrus-verification.json`;
const state: any = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      namespace: "walpen-verification-v1",
      createdAt: new Date().toISOString(),
      jobs: [],
    };
const client = MemWal.create({
  key: process.env.MEMWAL_PRIVATE_KEY!,
  accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: process.env.MEMWAL_SERVER_URL,
  namespace: state.namespace,
});
const save = () => writeFileSync(path, JSON.stringify(state, null, 2));
console.log(
  "Checking relayer compatibility and delegate authorization (no secrets logged).",
);
await client.compatibility();
await client.recall({ query: "WalPen verification", limit: 1 });
const facts = [
  "Đi bộ ven sông giúp nhân vật demo An bình tĩnh.",
  "An thích viết vài dòng trước khi ngủ.",
  "An thích trà hoa cúc không đường.",
  "An thích được hỏi từng câu một.",
  "An thường đọc sách vào sáng Chủ nhật.",
  "An đang học chơi đàn guitar.",
  "An thích những cuộc trò chuyện bằng tiếng Việt.",
  "An cảm thấy biết ơn khi gọi điện cho gia đình.",
  "An muốn dành mười phút mỗi ngày không dùng điện thoại.",
  "An thích nghe tiếng mưa khi viết.",
];
for (let i = 0; i < facts.length; i++) {
  if (state.jobs[i]?.blobId) continue;
  if (!state.jobs[i]) {
    state.jobs[i] = { index: i, status: "submitting" };
    save();
    const r = await client.remember(
      `WalPen synthetic demo verification ${i + 1}. Fictional person; not real user data. ${facts[i]}`,
    );
    state.jobs[i] = { index: i, jobId: r.job_id, status: "pending" };
    save();
  }
  if (!state.jobs[i].jobId)
    throw new Error("Ambiguous submission: reconcile before resubmitting.");
  const result = await client.waitForRememberJob(state.jobs[i].jobId, {
    timeoutMs: 180000,
  });
  state.jobs[i] = { ...state.jobs[i], blobId: result.blob_id, status: "done" };
  save();
  console.log(`Verified blob ${i + 1}/${facts.length}: ${result.blob_id}`);
}
// A separate client, with no transcript, verifies that recall survives sessions.
const fresh = MemWal.create({
  key: process.env.MEMWAL_PRIVATE_KEY!,
  accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: process.env.MEMWAL_SERVER_URL,
  namespace: state.namespace,
});
const recall = await fresh.recall({
  query: "Điều gì giúp An bình tĩnh?",
  limit: 3,
});
state.recall = {
  query: "Điều gì giúp An bình tĩnh?",
  results: recall.results.map((r) => ({ blobId: r.blob_id, text: r.text })),
  at: new Date().toISOString(),
};
save();
console.log(
  JSON.stringify({
    completed: state.jobs.filter((j: any) => j.blobId).length,
    recallMatches: recall.results.length,
    evidence: path,
  }),
);
