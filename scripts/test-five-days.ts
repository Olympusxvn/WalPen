import "dotenv/config";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Real integration test: five explicitly fictional pages, under the demo account.
// Reruns reuse matching entries and recorded write attempts; never blindly repost.
const origin = process.env.E2E_BASE_URL || "https://walpen.vercel.app";
const directory = "data/evidence";
mkdirSync(directory, { recursive: true });
const file = `${directory}/five-days.json`;
const report = `${directory}/five-days-report.md`;
const fixtures = [
  {
    date: "2026-09-15",
    title: "[DEMO 5 NGÀY] Một buổi sáng dịu lại",
    mood: "🌿",
    body: "Dữ liệu giả lập. Sáng nay An đi bộ 20 phút ở công viên trước khi bắt đầu làm việc. Những tán cây và nhịp bước chậm giúp An thấy nhẹ đầu hơn. An muốn thử giữ thói quen này.",
    memory:
      "Ngày 15/09/2026, nhân vật giả lập An đi bộ 20 phút ở công viên vào buổi sáng và thấy nhẹ đầu hơn.",
    question:
      "Trong nhật ký giả lập ngày 15/09/2026, An đã đi bộ ở đâu và trong bao lâu?",
    pattern: /20\s*(phút|minutes)/i,
    extra: /công viên|park/i,
    language: "vi",
  },
  {
    date: "2026-09-16",
    title: "[DEMO 5 NGÀY] Một phiên học vừa đủ",
    mood: "☀️",
    body: "Dữ liệu giả lập. An học Python trong một phiên 25 phút rồi nghỉ. Việc chia mục tiêu thành đoạn ngắn khiến bài học bớt ngợp. An hoàn thành bài tập vòng lặp đầu tiên.",
    memory:
      "Ngày 16/09/2026, nhân vật giả lập An học Python theo phiên 25 phút và hoàn thành bài tập vòng lặp.",
    question:
      "What did fictional An study on 16 September 2026, and how long was the study session?",
    pattern: /Python/i,
    extra: /25[\s-]*(minutes|minute)/i,
    language: "en",
  },
  {
    date: "2026-09-17",
    title: "[DEMO 5 NGÀY] Tắt màn hình sớm hơn",
    mood: "🌙",
    body: "Dữ liệu giả lập. Tối nay An uống trà hoa cúc không đường và cất điện thoại trước giờ ngủ 30 phút. An dành khoảng yên đó để đọc vài trang sách thay vì lướt tin.",
    memory:
      "Ngày 17/09/2026, nhân vật giả lập An uống trà hoa cúc không đường và cất điện thoại 30 phút trước khi ngủ.",
    question:
      "Trong ngày mẫu 17/09/2026, An uống loại trà nào và cất điện thoại bao lâu trước khi ngủ?",
    pattern: /hoa cúc/i,
    extra: /30\s*phút/i,
    language: "vi",
  },
  {
    date: "2026-09-18",
    title: "[DEMO 5 NGÀY] Bữa tối cùng một cuộc gọi",
    mood: "💛",
    body: "Dữ liệu giả lập. An gọi điện cho mẹ trong lúc chuẩn bị bữa tối. Hai mẹ con nói chuyện về món canh bí đỏ. Cuộc gọi giản dị khiến An cảm thấy được kết nối.",
    memory:
      "Ngày 18/09/2026, nhân vật giả lập An gọi điện cho mẹ và trò chuyện về món canh bí đỏ khi chuẩn bị bữa tối.",
    question: "Ngày mẫu 18/09/2026, An gọi cho ai và nói về món canh gì?",
    pattern: /mẹ/i,
    extra: /bí đỏ/i,
    language: "vi",
  },
  {
    date: "2026-09-19",
    title: "[DEMO 5 NGÀY] Dành chỗ cho âm nhạc",
    mood: "🎵",
    body: "Dữ liệu giả lập. Nhìn lại tuần, An muốn dành sáng Chủ nhật cho một sở thích nhỏ. An lên kế hoạch tập guitar 15 phút vào lúc 9 giờ, không đặt mục tiêu phải chơi hoàn hảo.",
    memory:
      "Ngày 19/09/2026, nhân vật giả lập An lên kế hoạch tập guitar 15 phút lúc 9 giờ sáng Chủ nhật.",
    question:
      "Theo trang nhật ký giả lập 19/09/2026, An dự định tập nhạc cụ gì, lúc mấy giờ và bao lâu?",
    pattern: /guitar|ghi.ta/i,
    extra: /9\s*(giờ|h).*(15\s*phút)|15\s*phút.*9\s*(giờ|h)/is,
    language: "vi",
  },
];
const state: any = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : {
      origin,
      username: process.env.E2E_USERNAME,
      startedAt: new Date().toISOString(),
      entries: {},
      trials: [],
    };
assert.equal(state.origin, origin, "Evidence belongs to another origin");
assert.equal(
  state.username,
  process.env.E2E_USERNAME,
  "Evidence belongs to another account",
);
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
let cookie = "";
async function api(path: string, body?: unknown) {
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path === "/api/chat" ? 180000 : 30000),
  });
  const data: any = await response.json();
  if (!response.ok)
    throw new Error(
      `${path}: ${response.status}: ${data.error || "Request failed"}`,
    );
  return { response, data };
}
async function login() {
  assert.ok(
    process.env.E2E_USERNAME && process.env.E2E_PASSWORD,
    "Configure the demo account locally",
  );
  cookie = "";
  const { response } = await api("/api/login", {
    username: process.env.E2E_USERNAME,
    password: process.env.E2E_PASSWORD,
  });
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie, "Login did not return a session");
}
await login();
let entries = (await api("/api/entries")).data.entries;
for (const fixture of fixtures) {
  const occurredAt = `${fixture.date}T13:00:00.000Z`;
  let entry = entries.find(
    (e: any) =>
      e.title === fixture.title &&
      Date.parse(e.occurredAt) === Date.parse(occurredAt),
  );
  if (!entry) {
    assert.ok(
      !state.entries[fixture.date],
      `Ambiguous previous submission on ${fixture.date}; reconcile before retrying`,
    );
    state.entries[fixture.date] = {
      status: "submitting",
      title: fixture.title,
    };
    save();
    entry = (
      await api("/api/entries", { ...fixture, occurredAt, consent: true })
    ).data.entry;
  }
  assert.equal(entry.body, fixture.body, "Existing fixture content differs");
  assert.equal(entry.memory, fixture.memory);
  assert.equal(entry.consent, true);
  state.entries[fixture.date] = entry;
  save();
  console.log(`${fixture.date}: ${entry.status} (${entry.id})`);
}
const deadline = Date.now() + 240000;
while (true) {
  entries = (await api("/api/entries")).data.entries;
  let confirmed = 0;
  for (const fixture of fixtures) {
    const entry = entries.find(
      (e: any) => e.id === state.entries[fixture.date].id,
    );
    assert.ok(entry, `Missing ${fixture.date}`);
    state.entries[fixture.date] = entry;
    if (entry.status === "synced" && entry.blobId) confirmed++;
    if (["failed", "uncertain"].includes(entry.status)) {
      save();
      throw new Error(
        `${fixture.date}: ${entry.status}; no automatic resubmission`,
      );
    }
  }
  save();
  console.log(`Walrus confirmed: ${confirmed}/5`);
  if (confirmed === 5) break;
  if (Date.now() > deadline)
    throw new Error(
      "Confirmation still pending; rerun to resume existing entries",
    );
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert.equal(
  new Set(Object.values(state.entries).map((e: any) => e.blobId)).size,
  5,
);
await login(); // New session, no prior conversation transcript.
const persisted = (await api("/api/entries")).data.entries;
assert.ok(
  fixtures.every((f) =>
    persisted.some(
      (e: any) => e.id === state.entries[f.date].id && e.status === "synced",
    ),
  ),
);
state.freshSessionVerified = true;
save();
for (const fixture of fixtures) {
  const previous = state.trials.find(
    (trial: any) => trial.date === fixture.date,
  );
  if (previous?.answer && previous?.sources) {
    const sourceIndex = previous.sources.findIndex(
      (s: any) => s.blobId === state.entries[fixture.date].blobId,
    );
    previous.checks = {
      expectedSource: sourceIndex >= 0,
      correctFacts:
        fixture.pattern.test(previous.answer) &&
        fixture.extra.test(previous.answer),
      citesExpectedSource:
        sourceIndex >= 0 && previous.answer.includes(`[${sourceIndex + 1}]`),
    };
    previous.passed = Object.values(previous.checks).every(Boolean);
    save();
  }
  if (
    state.trials.some(
      (trial: any) => trial.date === fixture.date && trial.passed,
    )
  )
    continue;
  const start = Date.now();
  try {
    const { data } = await api("/api/chat", {
      message: fixture.question,
      history: [],
      useMemory: true,
      language: fixture.language,
    });
    const sourceIndex = data.sources.findIndex(
      (s: any) => s.blobId === state.entries[fixture.date].blobId,
    );
    const checks = {
      expectedSource: sourceIndex >= 0,
      correctFacts:
        fixture.pattern.test(data.answer) && fixture.extra.test(data.answer),
      citesExpectedSource:
        sourceIndex >= 0 && data.answer.includes(`[${sourceIndex + 1}]`),
    };
    const result = {
      date: fixture.date,
      question: fixture.question,
      ...data,
      checks,
      elapsedMs: Date.now() - start,
      passed: Object.values(checks).every(Boolean),
    };
    state.trials = state.trials.filter(
      (trial: any) => trial.date !== fixture.date,
    );
    state.trials.push(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    state.trials = state.trials.filter(
      (trial: any) => trial.date !== fixture.date,
    );
    state.trials.push({
      date: fixture.date,
      passed: false,
      error: String(error),
    });
    console.log(`${fixture.date}: ${String(error)}`);
  }
  save();
}
if (!state.memoryOff?.passed) {
  const { data } = await api("/api/chat", {
    message:
      "Trong các trang nhật ký mẫu của An, món canh được nhắc đến là gì?",
    history: [],
    useMemory: false,
    language: "vi",
  });
  state.memoryOff = {
    ...data,
    passed:
      data.sources.length === 0 &&
      data.memoryUsed === false &&
      !/bí đỏ|\[\d+\]/i.test(data.answer),
  };
  save();
  console.log(JSON.stringify({ memoryOff: state.memoryOff }));
}
state.finishedAt = new Date().toISOString();
save();
const rows = fixtures
  .map((f) => {
    const trial = state.trials.find((t: any) => t.date === f.date);
    return `| ${f.date} | ${f.title.replace("[DEMO 5 NGÀY] ", "")} | ${state.entries[f.date].status} | ${trial?.passed ? "PASS" : "FAIL"} |`;
  })
  .join("\n");
const answers = state.trials
  .map(
    (t: any) =>
      `### ${t.date}\n\n${t.question || ""}\n\n${t.answer || t.error}\n\nChecks: ${JSON.stringify(t.checks)}; ${t.elapsedMs || 0} ms.`,
  )
  .join("\n\n");
writeFileSync(
  report,
  `# Kiểm thử 5 ngày nhật ký giả lập\n\nTài khoản: ${process.env.E2E_USERNAME}. URL: ${origin}.\n\nTất cả nội dung là dữ liệu giả, không phải nhật ký người thật. Mỗi trang được cho phép dùng làm bộ nhớ.\n\n| Ngày | Nội dung | Walrus | Recall + câu trả lời + dẫn nguồn |\n|---|---|---|---|\n${rows}\n\nPhiên đăng nhập mới: ${state.freshSessionVerified ? "PASS" : "FAIL"}. Tắt bộ nhớ: ${state.memoryOff?.passed ? "PASS" : "FAIL"}.\n\n${answers}\n\n### Tắt bộ nhớ\n\n${state.memoryOff?.answer || ""}\n\nBằng chứng blob ID và kết quả đầy đủ: five-days.json. Đây là kiểm thử fixture, không phải đánh giá độ chính xác tổng quát.\n`,
);
assert.ok(
  state.trials.length === 5 &&
    state.trials.every((trial: any) => trial.passed) &&
    state.memoryOff.passed,
  `Some checks failed; see ${report}`,
);
console.log(
  `PASS: 5 saved days, 5 distinct Mainnet blobs, fresh session, 5 grounded answers and memory-off check. Report: ${report}`,
);
