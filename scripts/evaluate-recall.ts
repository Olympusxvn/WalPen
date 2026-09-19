import "dotenv/config";
import { MemWal } from "@mysten-incubation/memwal";
import { readFileSync, writeFileSync } from "node:fs";
const evidence = JSON.parse(
  readFileSync("data/evidence/walrus-verification.json", "utf8"),
);
const client = MemWal.create({
  key: process.env.MEMWAL_PRIVATE_KEY!,
  accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: process.env.MEMWAL_SERVER_URL,
  namespace: evidence.namespace,
});
const questions = [
  "Hoạt động nào giúp An bình tĩnh?",
  "An viết vào thời điểm nào?",
  "An thích uống trà gì?",
  "Nên hỏi An nhiều câu hay từng câu?",
  "An làm gì sáng Chủ nhật?",
  "An đang học nhạc cụ nào?",
  "An thích dùng ngôn ngữ gì?",
  "Điều gì làm An thấy biết ơn?",
  "An muốn dành bao lâu không dùng điện thoại?",
  "An thích âm thanh gì lúc viết?",
];
const results = [];
for (let i = 0; i < questions.length; i++) {
  const found = await client.recall({ query: questions[i], limit: 3 });
  const expected = evidence.jobs[i].blobId;
  results.push({
    query: questions[i],
    expectedBlob: expected,
    passed: found.results.some((r) => r.blob_id === expected),
    matches: found.results.map((r) => ({
      blobId: r.blob_id,
      distance: r.distance,
    })),
  });
}
const passed = results.filter((r) => r.passed).length;
writeFileSync(
  "data/evidence/recall-evaluation.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      type: "synthetic recall top-3; not human-use evaluation",
      passed,
      total: results.length,
      results,
    },
    null,
    2,
  ),
);
console.log(
  `Synthetic recall evaluation: ${passed}/${results.length} expected blobs found in top 3.`,
);
if (passed < 9) process.exitCode = 1;
