import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Telegram } from "telegraf";
import request from "supertest";
import { createApp } from "../server/app.ts";
import type { ChatModel, Source } from "../server/llm.ts";
import { budgetMemoryContext } from "../server/memory-context.ts";
import type { MemoryGateway, MemoryRecall } from "../server/memory.ts";
import type { Repository } from "../server/repository.ts";
import { selectRecallContext } from "../server/recall.ts";
import { hash, Store, type Entry } from "../server/store.ts";
import { serializeMemory } from "../server/write-intent.ts";

const config = {
  botToken: "123456789:telegram-test-token",
  webhookSecret: "telegram_test_secret_123",
  appOrigin: "https://walpen.example",
  recallTimeoutMs: 8_000,
};
const update = (updateId: number, text = "/start", languageCode = "en") => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    from: {
      id: 123456789,
      is_bot: false,
      first_name: "Judge",
      language_code: languageCode,
    },
    chat: { id: 123456789, type: "private", first_name: "Judge" },
    date: 1_800_000_000,
    text,
  },
});
const model: ChatModel = {
  configured: false,
  name: "test-model",
  async answer() {
    throw new Error("not used in Task 3");
  },
};
const memory: MemoryGateway = {
  configured: false,
  prepare() {
    throw new Error("not used in Task 3");
  },
  async remember() {
    throw new Error("not used in Task 3");
  },
  async wait() {
    throw new Error("not used in Task 3");
  },
  async recall() {
    throw new Error("not used in Task 3");
  },
};
function fixture(
  options: {
    store?: Repository;
    background?: (work: Promise<unknown>) => void;
    memory?: MemoryGateway;
    model?: ChatModel;
    telegram?: Partial<typeof config>;
  } = {},
) {
  const store = options.store ?? new Store(":memory:", randomBytes(32));
  const jobs: Promise<unknown>[] = [];
  const { app } = createApp(
    store,
    options.memory ?? memory,
    options.model ?? model,
    {
      rateLimits: false,
      telegram: { ...config, ...options.telegram },
      background: options.background ?? ((work) => jobs.push(work)),
    },
  );
  return { app, store, jobs };
}
function linkedStore(store: Store, telegramId = "123456789") {
  const now = Date.now();
  const user = {
    id: "telegram-owner",
    username: "telegram-owner",
    password: "test-password",
    createdAt: new Date(now).toISOString(),
  };
  store.addUser(user);
  store.issueTelegramLinkCode({
    telegramId,
    codeHash: "telegram-link-code-digest",
    createdAt: now,
    expiresAt: now + 600_000,
  });
  assert.equal(
    store.consumeTelegramLinkCode(
      "telegram-link-code-digest",
      user.id,
      now,
    ),
    "linked",
  );
  return user;
}
function writeMemory(options: {
  writes?: string[];
  remember?: () => Promise<string>;
} = {}): MemoryGateway {
  return {
    configured: true,
    prepare(entry) {
      return {
        accountId: "test-account",
        serverUrl: "https://memory.example",
        namespace: `walpen-v1-${entry.userId}`,
        text: serializeMemory(entry),
      };
    },
    async remember(entry) {
      options.writes?.push(entry.id);
      return options.remember?.() ?? `job-${entry.id}`;
    },
    async wait(_userId, jobId) {
      return `blob-${jobId}`;
    },
    async recall() {
      return { results: [] };
    },
  };
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitUntil(
  predicate: () => boolean,
  ms: number,
  message: string,
) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await delay(10);
  }
}
function withSendMessage(
  send: (chatId: number | string, text: string) => Promise<unknown>,
) {
  const original = Telegram.prototype.sendMessage;
  Telegram.prototype.sendMessage = function (chatId, text) {
    return send(chatId, String(text)) as any;
  };
  return () => {
    Telegram.prototype.sendMessage = original;
  };
}
const codePoints = (text: string) => Array.from(text).length;
const cacheNotice = {
  en: "Remote recall is unavailable. The encrypted cache supplied the cited Walrus blobs.",
  vi: "Không truy xuất được ký ức từ xa. Bộ nhớ đệm đã mã hóa cung cấp các blob Walrus được trích dẫn.",
};
const emptyRecallNotice = {
  en: "Remote recall is unavailable. No encrypted-cache memory matched this question, so this answer does not claim remembered facts.",
  vi: "Không truy xuất được ký ức từ xa. Không có ký ức trong bộ nhớ đệm khớp câu hỏi, nên câu trả lời này không khẳng định sự kiện đã nhớ.",
};
const modelUnavailableNotice = {
  en: "WalPen can’t answer yet because the AI model is not configured.",
  vi: "WalPen chưa thể trả lời vì mô hình AI chưa được cấu hình.",
};
const modelFailedNotice = {
  en: "WalPen couldn’t complete this answer. Please try again shortly.",
  vi: "WalPen chưa thể hoàn tất câu trả lời. Vui lòng thử lại sau.",
};
const recallFailedNotice = {
  en: "WalPen couldn’t read your memories just now. Please try again shortly.",
  vi: "WalPen chưa đọc được ký ức lúc này. Vui lòng thử lại sau.",
};
const chatUsageNotice = {
  en: "Usage: /chat followed by a question.",
  vi: "Cách dùng: /chat kèm một câu hỏi.",
};
const linkFirstNotice =
  "Connect your WalPen account first: send /start for a one-time link code.";
function journal(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    rootId: id,
    revision: 1,
    supersedes: null,
    title: "Note",
    body: "Approved fact",
    memory: "Approved fact",
    mood: "🌿",
    consent: true,
    occurredAt: "2026-10-03T00:00:00.000Z",
    createdAt: "2026-10-03T00:00:00.000Z",
    status: "synced",
    jobId: `job-${id}`,
    blobId: `blob-${id}`,
    error: null,
    retired: false,
    ...overrides,
    id,
    userId: "telegram-owner",
  };
}
function recallHit(entry: Entry, distance = 0.1) {
  return {
    blob_id: entry.blobId ?? `missing-${entry.id}`,
    text: serializeMemory(entry),
    distance,
  };
}
function chatMemory(recall: MemoryGateway["recall"]): MemoryGateway {
  return {
    configured: true,
    prepare() {
      throw new Error("prepare is not used for chat");
    },
    async remember() {
      throw new Error("remember is not used for chat");
    },
    async wait() {
      throw new Error("wait is not used for chat");
    },
    recall,
  };
}
function answeringModel(
  answer: ChatModel["answer"],
  configured = true,
): ChatModel {
  return { configured, name: "telegram-test-model", answer };
}
function captureConsole() {
  const lines: string[] = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const write = (...args: unknown[]) => {
    lines.push(
      args
        .map((value) => {
          if (value instanceof Error)
            return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
          if (typeof value === "string") return value;
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(" "),
    );
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  console.debug = write;
  return {
    lines,
    restore() {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
    },
  };
}
function postUpdate(
  app: ReturnType<typeof fixture>["app"],
  updateId: number,
  text: string,
  languageCode = "en",
) {
  return request(app)
    .post("/api/telegram-webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
    .send(update(updateId, text, languageCode));
}

test("webhook rejects an incorrect Telegram secret", async () => {
  const f = fixture();
  const response = await request(f.app)
    .post("/api/telegram-webhook")
    .set("X-Telegram-Bot-Api-Secret-Token", "wrong_secret")
    .send(update(101))
    .expect(401);
  assert.equal(response.text, "");
  assert.equal(f.jobs.length, 0);
  assert.equal(
    (f.store as Store).db
      .prepare("SELECT COUNT(*) AS count FROM telegram_updates")
      .get()?.count,
    0,
  );
  (f.store as Store).db.close();
});

test("webhook returns 200 after encrypted enqueue without awaiting a slow worker", async () => {
  const f = fixture();
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sendStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const restore = withSendMessage(async () => {
    entered();
    await blocked;
    return {};
  });
  try {
    const requestPromise = request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(102))
      .expect(200);
    const response = await Promise.race([
      requestPromise,
      delay(1_000).then(() => {
        throw new Error("webhook waited for background Telegram work");
      }),
    ]);
    await Promise.race([
      sendStarted,
      delay(1_000).then(() => {
        throw new Error("background worker did not start");
      }),
    ]);
    assert.equal(f.jobs.length, 1);
    const raw = (f.store as Store).db
      .prepare(
        "SELECT payload_ciphertext FROM telegram_updates WHERE update_id=?",
      )
      .get(102) as { payload_ciphertext: string };
    assert.ok(!raw.payload_ciphertext.includes("/start"));
    assert.ok(!raw.payload_ciphertext.includes("123456789"));
    assert.equal(response.text, "");
    release();
    await Promise.all(f.jobs);
  } finally {
    release();
    restore();
    (f.store as Store).db.close();
  }
});

test("webhook owns a single response", async () => {
  const f = fixture();
  let messages = 0;
  const restore = withSendMessage(async () => {
    messages++;
    return {};
  });
  try {
    const response = await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(103))
      .expect(200);
    await Promise.all(f.jobs);
    assert.equal(response.text, "");
    assert.equal(f.jobs.length, 1);
    assert.equal(messages, 1);
  } finally {
    restore();
    (f.store as Store).db.close();
  }
});

test("webhook enqueue failure returns a retryable error", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const broken = new Proxy(store, {
    get(target, property) {
      if (property === "enqueueTelegramUpdate")
        return () => {
          throw new Error("database unavailable with private payload");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Repository;
  const f = fixture({ store: broken });
  const restore = withSendMessage(async () => ({}));
  try {
    const response = await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(104))
      .expect(500);
    assert.deepEqual(response.body, {
      error: "Yêu cầu không thực hiện được. Vui lòng thử lại.",
    });
    assert.ok(!JSON.stringify(response.body).includes("database unavailable"));
    assert.equal(f.jobs.length, 0);
  } finally {
    restore();
    store.db.close();
  }
});

test("duplicate update is acknowledged without duplicate job", async () => {
  const f = fixture();
  let messages = 0;
  const restore = withSendMessage(async () => {
    messages++;
    return {};
  });
  try {
    const send = () =>
      request(f.app)
        .post("/api/telegram-webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
        .send(update(105))
        .expect(200);
    await send();
    await Promise.all(f.jobs);
    await send();
    await Promise.all(f.jobs);
    assert.equal(
      (f.store as Store).db
        .prepare("SELECT COUNT(*) AS count FROM telegram_updates")
        .get()?.count,
      1,
    );
    assert.equal(f.jobs.length, 1);
    assert.equal(messages, 1);
  } finally {
    restore();
    (f.store as Store).db.close();
  }
});

test("webhook is unavailable while Telegram credentials are missing", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const { app } = createApp(store, memory, model, { rateLimits: false });
  await request(app)
    .post("/api/telegram-webhook")
    .send(update(106))
    .expect(503);
  store.db.close();
});

test("start issues a private one-time code without persisting its plaintext", async () => {
  const f = fixture();
  let reply = "";
  const restore = withSendMessage(async (_chatId, text) => {
    reply = text;
    return {};
  });
  try {
    await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(107))
      .expect(200);
    await Promise.all(f.jobs);
    const code = reply.match(/\b[A-F0-9]{12}\b/)?.[0];
    assert.ok(code);
    const stored = (f.store as Store).db
      .prepare(
        "SELECT code_hash,created_at,expires_at FROM telegram_link_codes",
      )
      .get() as { code_hash: string; created_at: number; expires_at: number };
    assert.equal(
      stored.code_hash,
      hash(code),
    );
    assert.equal(stored.expires_at - stored.created_at, 600_000);
    assert.ok(!stored.code_hash.includes(code));
  } finally {
    restore();
    (f.store as Store).db.close();
  }
});

test("start greets an already linked Telegram identity without issuing another code", async () => {
  const f = fixture();
  const owner = {
    id: "telegram-owner",
    username: "telegram-owner",
    password: "test-password",
    createdAt: new Date().toISOString(),
  };
  (f.store as Store).addUser(owner);
  (f.store as Store).issueTelegramLinkCode({
    telegramId: "123456789",
    codeHash: "linked-code-digest",
    createdAt: Date.now(),
    expiresAt: Date.now() + 600_000,
  });
  (f.store as Store).consumeTelegramLinkCode(
    "linked-code-digest",
    owner.id,
    Date.now(),
  );
  let reply = "";
  const restore = withSendMessage(async (_chatId, text) => {
    reply = text;
    return {};
  });
  try {
    await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(108))
      .expect(200);
    await Promise.all(f.jobs);
    assert.match(reply, /connected to WalPen/i);
    assert.equal(
      (f.store as Store).db
        .prepare("SELECT COUNT(*) AS count FROM telegram_link_codes")
        .get()?.count,
      0,
    );
  } finally {
    restore();
    (f.store as Store).db.close();
  }
});

test("write stores an encrypted approved Entry and returns queued status", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const user = linkedStore(store);
  const writes: string[] = [];
  const f = fixture({ store, memory: writeMemory({ writes }) });
  let release!: () => void;
  let rememberStarted!: () => void;
  const delayed = new Promise<string>((resolve) => {
    release = () => resolve("job-telegram-entry");
  });
  const started = new Promise<void>((resolve) => {
    rememberStarted = resolve;
  });
  const delayedMemory = writeMemory({
    writes,
    remember: async () => {
      rememberStarted();
      return delayed;
    },
  });
  const app = createApp(store, delayedMemory, model, {
    rateLimits: false,
    telegram: config,
    background: (work) => f.jobs.push(work),
  }).app;
  let sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  const plainText = "A private thought from Telegram 🪷";
  try {
    const response = await request(app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(109, `/write ${plainText}`))
      .expect(200);
    await Promise.race([
      started,
      delay(1_000).then(() => {
        throw new Error(
          `Walrus sync did not start in the worker; replies=${sent.join(" | ")}; entries=${store.list(user.id).length}`,
        );
      }),
    ]);
    assert.equal(response.text, "");
    assert.equal(sent.length, 1);
    assert.match(sent[0], /queued|in.*queue/i);
    const entryRows = store.db
      .prepare("SELECT * FROM entries WHERE userId=?")
      .all(user.id) as any[];
    assert.equal(entryRows.length, 1);
    const entry = store.get(entryRows[0].id, user.id)!;
    assert.equal(entry.title, "Telegram journal");
    assert.equal(entry.body, plainText);
    assert.equal(entry.memory, plainText);
    assert.equal(entry.consent, true);
    assert.equal(entry.status, "submitting");
    assert.equal(entry.rootId, entry.id);
    assert.equal(entry.revision, 1);
    assert.ok(!entryRows[0].payload.includes(plainText));
    assert.ok(writes.includes(entry.id));
    assert.equal((await store.writeIntent(entry.id))?.intent.key.length, 36);
    release();
    await Promise.all(f.jobs);
    assert.equal(store.get(entry.id, user.id)?.blobId, "blob-job-telegram-entry");
  } finally {
    release();
    restore();
    store.db.close();
  }
});

test("write update replay does not add another Entry or MemWal submission", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const user = linkedStore(store);
  const writes: string[] = [];
  const f = fixture({ store, memory: writeMemory({ writes }) });
  const restore = withSendMessage(async () => ({}));
  try {
    const send = () =>
      request(f.app)
        .post("/api/telegram-webhook")
        .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
        .send(update(110, "/write A repeatable Telegram note"))
        .expect(200);
    await send();
    await Promise.all(f.jobs);
    await send();
    await Promise.all(f.jobs);
    assert.equal(store.list(user.id).length, 1);
    assert.equal(writes.length, 1);
  } finally {
    restore();
    store.db.close();
  }
});

test("write rejects empty and oversized text", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  const f = fixture({ store, memory: writeMemory() });
  const replies: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    replies.push(text);
    return {};
  });
  try {
    await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(111, "/write"))
      .expect(200);
    await Promise.all(f.jobs);
    const oversized = await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(112, `/write ${"🌿".repeat(4001)}`));
    assert.equal(oversized.status, 200, oversized.text);
    await Promise.all(f.jobs);
    assert.equal(store.list("telegram-owner").length, 0);
    assert.equal(replies.length, 2);
    assert.ok(replies.every((reply) => /4,000|4\.000|too long|empty|nội dung/i.test(reply)));
  } finally {
    restore();
    store.db.close();
  }
});

test("write reports a persistence failure without claiming the entry was saved", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  const failing = new Proxy(store, {
    get(target, property) {
      if (property === "insertTelegramEntry")
        return () => {
          throw new Error("private content must not be reported");
        };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Repository;
  const f = fixture({ store: failing, memory: writeMemory() });
  let reply = "";
  const restore = withSendMessage(async (_chatId, text) => {
    reply = text;
    return {};
  });
  try {
    await request(f.app)
      .post("/api/telegram-webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhookSecret)
      .send(update(113, "/write A note whose save fails"))
      .expect(200);
    await Promise.all(f.jobs);
    assert.match(reply, /couldn.?t save|not saved|chưa lưu|chưa thể lưu/i);
    assert.doesNotMatch(reply, /private content must not be reported/);
    assert.equal(store.list("telegram-owner").length, 0);
    const queued = store.db
      .prepare("SELECT state, safe_error_code FROM telegram_updates WHERE update_id=113")
      .get() as { state: string; safe_error_code: string };
    assert.equal(queued.state, "queued");
    assert.equal(queued.safe_error_code, "telegram_entry_persistence_failed");
  } finally {
    restore();
    store.db.close();
  }
});

test("telegram webhook returns 200 before delayed recall and model complete", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  let recallStarted = false;
  let modelStarted = false;
  let releaseRecall = (_value: MemoryRecall) => {};
  let releaseModel = (_value: string) => {};
  const recallGate = new Promise<MemoryRecall>((resolve) => {
    releaseRecall = resolve;
  });
  const modelGate = new Promise<string>((resolve) => {
    releaseModel = resolve;
  });
  const f = fixture({
    store,
    memory: chatMemory(async () => {
      recallStarted = true;
      return recallGate;
    }),
    model: answeringModel(async (question, history, sources, language) => {
      modelStarted = true;
      assert.equal(question, "Where was the lotus?");
      assert.deepEqual(history, []);
      assert.deepEqual(sources, []);
      assert.equal(language, "en");
      return modelGate;
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    const response = await Promise.race([
      postUpdate(f.app, 201, "Where was the lotus?").expect(200),
      delay(1_000).then(() => {
        throw new Error("webhook waited for recall or the model");
      }),
    ]);
    await waitUntil(
      () => recallStarted,
      1_000,
      "background chat did not start recall",
    );
    assert.equal(response.text, "");
    assert.equal(modelStarted, false);
    assert.deepEqual(sent, []);
    releaseRecall({ results: [] });
    await waitUntil(
      () => modelStarted,
      1_000,
      "background chat did not start the model",
    );
    assert.deepEqual(sent, []);
    releaseModel("The lotus was by the water.");
    await Promise.all(f.jobs);
    assert.deepEqual(sent, ["The lotus was by the water."]);
  } finally {
    releaseRecall({ results: [] });
    releaseModel("late");
    restore();
    store.db.close();
  }
});

test("telegram chat uses only consented relevant memories within five sources and 768 tokens", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const user = linkedStore(store);
  const facts = [0, 1, 2, 3].map((index) =>
    journal(`fact-${index}`, {
      memory: `lotus fact ${index}`,
      blobId: `blob-fact-${index}`,
    }),
  );
  const huge = journal("huge", {
    memory: "walk ".repeat(800),
    blobId: "blob-huge-omitted",
  });
  const extra = journal("extra", {
    memory: "lotus extra fact",
    blobId: "blob-extra-omitted",
  });
  const denied = journal("denied", {
    consent: false,
    memory: "lotus denied fact",
    blobId: "blob-denied",
  });
  const distant = journal("distant", {
    memory: "lotus distant fact",
    blobId: "blob-distant",
  });
  const queued = journal("queued", {
    status: "queued",
    memory: "lotus queued fact",
    blobId: "blob-queued",
  });
  const retired = journal("retired", {
    retired: true,
    memory: "lotus retired fact",
    blobId: "blob-retired",
  });
  const mismatch = journal("mismatch", {
    memory: "lotus real memory",
    blobId: "blob-mismatch",
  });
  for (const entry of [
    ...facts,
    huge,
    extra,
    denied,
    distant,
    queued,
    retired,
    mismatch,
  ])
    store.insert(entry);
  const results = [
    recallHit(denied),
    recallHit(distant, 0.95),
    recallHit(queued),
    recallHit(retired),
    {
      ...recallHit(mismatch),
      text: serializeMemory({ ...mismatch, memory: "lotus forged memory" }),
    },
    ...facts.map((entry) => recallHit(entry)),
    recallHit(huge),
    recallHit(extra),
  ];
  const expected = selectRecallContext(
    { results },
    store.list(user.id),
    0.7,
  );
  assert.ok(results.length > 5);
  assert.equal(expected.sources.length, 4);
  assert.ok(expected.sources.length <= 5);
  assert.ok(expected.meta.tokenEstimate <= 768);
  assert.deepEqual(
    expected.sources.map((source) => source.id),
    ["fact-0", "fact-1", "fact-2", "fact-3"],
  );
  const question = "Where did the lotus grow DATA_ENCRYPTION_KEY";
  const calls: {
    question: string;
    history: { role: string; content: string }[];
    sources: Source[];
    language?: string;
  }[] = [];
  const logs = captureConsole();
  const f = fixture({
    store,
    memory: chatMemory(async (userId, query) => {
      assert.equal(userId, user.id);
      assert.equal(query, question);
      return { results };
    }),
    model: answeringModel(async (message, history, sources, language) => {
      calls.push({ question: message, history, sources, language });
      return "A calm answer.";
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (chatId, text) => {
    assert.equal(String(chatId), "123456789");
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 202, question).expect(200);
    await Promise.all(f.jobs);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].question, question);
    assert.deepEqual(calls[0].history, []);
    assert.equal(calls[0].language, "en");
    assert.deepEqual(calls[0].sources, expected.sources);
    const joined = sent.join("\n");
    assert.match(joined, /A calm answer\./);
    for (const source of expected.sources)
      assert.ok(joined.includes(`Walrus blob: ${source.blobId}`));
    for (const blobId of [
      "blob-huge-omitted",
      "blob-extra-omitted",
      "blob-denied",
      "blob-distant",
      "blob-queued",
      "blob-retired",
      "blob-mismatch",
    ])
      assert.equal(joined.includes(blobId), false);
    assert.equal(joined.includes(question), false);
    assert.equal(joined.includes("lotus forged memory"), false);
    assert.equal(logs.lines.join("\n").includes(question), false);
    assert.equal(logs.lines.join("\n").includes("DATA_ENCRYPTION_KEY"), false);
    assert.ok(sent.every((text) => codePoints(text) <= 4096));
  } finally {
    logs.restore();
    restore();
    store.db.close();
  }
});

test("chat includes full Walrus blob IDs for selected sources", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const user = linkedStore(store);
  const firstId = `walrus_${"a".repeat(180)}`;
  const secondId = `walrus_${"b".repeat(180)}`;
  const first = journal("first", {
    memory: "lotus by the gate",
    blobId: firstId,
  });
  const second = journal("second", {
    memory: "lotus by the pond",
    blobId: secondId,
  });
  store.insert(first);
  store.insert(second);
  const calls: Source[][] = [];
  const f = fixture({
    store,
    memory: chatMemory(async () => ({
      results: [recallHit(first, 0.2), recallHit(second, 0.3)],
    })),
    model: answeringModel(async (_question, history, sources) => {
      assert.deepEqual(history, []);
      calls.push(sources);
      return "Both places are saved.";
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 203, "Where is the lotus?").expect(200);
    await Promise.all(f.jobs);
    const expected = selectRecallContext(
      { results: [recallHit(first, 0.2), recallHit(second, 0.3)] },
      store.list(user.id),
      0.7,
    );
    assert.deepEqual(calls[0], expected.sources);
    const joined = sent.join("");
    assert.ok(joined.includes(`Source 1 · Walrus blob: ${firstId}`));
    assert.ok(joined.includes(`Source 2 · Walrus blob: ${secondId}`));
    assert.equal(joined.split(firstId).length - 1, 1);
    assert.equal(joined.split(secondId).length - 1, 1);
    assert.ok(sent.every((text) => codePoints(text) <= 4096));
    assert.equal(sent.some((text) => text.includes("Both places are saved.")), true);
  } finally {
    restore();
    store.db.close();
  }
});

test("normal text and chat command use the configured model", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  const calls: {
    question: string;
    history: unknown[];
    sources: Source[];
    language?: string;
  }[] = [];
  const f = fixture({
    store,
    memory: chatMemory(async () => ({ results: [] })),
    model: answeringModel(async (question, history, sources, language) => {
      calls.push({ question, history, sources, language });
      return `Answer: ${question}`;
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 204, "Which lotus bloomed?").expect(200);
    await Promise.all(f.jobs);
    await postUpdate(f.app, 205, "/chat Which lotus bloomed?").expect(200);
    await Promise.all(f.jobs);
    await postUpdate(
      f.app,
      206,
      "/chat@walpen_bot Which lotus bloomed?",
      "vi",
    ).expect(200);
    await Promise.all(f.jobs);
    await postUpdate(f.app, 207, "/chat   ").expect(200);
    await Promise.all(f.jobs);
    await postUpdate(f.app, 208, "/chat@walpen_bot", "vi").expect(200);
    await Promise.all(f.jobs);
    assert.deepEqual(
      calls.map((call) => call.question),
      ["Which lotus bloomed?", "Which lotus bloomed?", "Which lotus bloomed?"],
    );
    assert.deepEqual(
      calls.map((call) => call.language),
      ["en", "en", "vi"],
    );
    assert.ok(calls.every((call) => call.history.length === 0));
    assert.ok(calls.every((call) => call.sources.length === 0));
    assert.equal(sent.filter((text) => text === "Answer: Which lotus bloomed?").length, 3);
    assert.equal(sent.filter((text) => text === chatUsageNotice.en).length, 1);
    assert.equal(sent.filter((text) => text === chatUsageNotice.vi).length, 1);
  } finally {
    restore();
    store.db.close();
  }
});

test("unlinked users are directed to start", async () => {
  const store = new Store(":memory:", randomBytes(32));
  let recalled = false;
  let answered = false;
  const f = fixture({
    store,
    memory: chatMemory(async () => {
      recalled = true;
      return { results: [] };
    }),
    model: answeringModel(async () => {
      answered = true;
      return "should not answer";
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 209, "What did I plant?").expect(200);
    await Promise.all(f.jobs);
    await postUpdate(f.app, 210, "/chat What did I plant?").expect(200);
    await Promise.all(f.jobs);
    assert.deepEqual(sent, [linkFirstNotice, linkFirstNotice]);
    assert.equal(recalled, false);
    assert.equal(answered, false);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS count FROM telegram_link_codes").get()
        ?.count,
      0,
    );
  } finally {
    restore();
    store.db.close();
  }
});

function cacheEntries(): Entry[] {
  return [
    journal("full-new", {
      memory: "Lotus Garden Walk",
      createdAt: "2026-10-06T00:00:00.000Z",
      blobId: "cache-full-new",
    }),
    journal("full-old", {
      memory: "lotus garden walk",
      createdAt: "2026-10-01T00:00:00.000Z",
      blobId: "cache-full-old",
    }),
    journal("two-new", {
      memory: "lotus garden",
      createdAt: "2026-10-05T00:00:00.000Z",
      blobId: "cache-two-new",
    }),
    journal("two-old", {
      memory: "garden walk,",
      createdAt: "2026-10-02T00:00:00.000Z",
      blobId: "cache-two-old",
    }),
    journal("huge", {
      memory: "walk ".repeat(800),
      createdAt: "2026-10-04T00:00:00.000Z",
      blobId: "cache-huge",
    }),
    journal("extra", {
      memory: "lotus pond",
      createdAt: "2026-10-03T00:00:00.000Z",
      blobId: "cache-extra",
    }),
    journal("none", {
      memory: "bicycle shed",
      blobId: "cache-none",
    }),
    journal("denied", {
      consent: false,
      memory: "lotus garden walk",
      blobId: "cache-denied",
    }),
    journal("queued", {
      status: "queued",
      memory: "lotus garden walk",
      blobId: "cache-queued",
    }),
    journal("retired", {
      retired: true,
      memory: "lotus garden walk",
      blobId: "cache-retired",
    }),
    journal("empty-blob", {
      memory: "lotus garden walk",
      blobId: "",
    }),
  ];
}

test("502 and 504 recall failures use only eligible cached memories", async () => {
  const store = new Store(":memory:", randomBytes(32));
  const user = linkedStore(store);
  for (const entry of cacheEntries()) store.insert(entry);
  const query = "lotus garden walk";
  const calls: { sources: Source[]; language?: string }[] = [];
  let attempt = 0;
  const logs = captureConsole();
  const f = fixture({
    store,
    memory: chatMemory(async () => {
      attempt += 1;
      const status = attempt === 1 ? 502 : 504;
      throw Object.assign(
        new Error(`relayer secret ${status} DATA_ENCRYPTION_KEY ${query}`),
        { status },
      );
    }),
    model: answeringModel(async (_question, history, sources, language) => {
      assert.deepEqual(history, []);
      calls.push({ sources, language });
      return "From the encrypted cache.";
    }),
  });
  const sent: string[][] = [[], []];
  let index = 0;
  const restore = withSendMessage(async (_chatId, text) => {
    sent[index].push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 211, query).expect(200);
    await Promise.all(f.jobs);
    index = 1;
    await postUpdate(f.app, 212, query, "vi").expect(200);
    await Promise.all(f.jobs);
    const expectedIds = [
      "cache-full-new",
      "cache-full-old",
      "cache-two-new",
      "cache-two-old",
    ];
    assert.deepEqual(
      calls.map((call) => call.sources.map((source) => source.blobId)),
      [expectedIds, expectedIds],
    );
    assert.deepEqual(
      calls.map((call) => call.language),
      ["en", "vi"],
    );
    assert.ok(calls[0].sources.length <= 5);
    assert.ok(
      budgetMemoryContext(calls[0].sources).meta.tokenEstimate <= 768,
    );
    const english = sent[0].join("");
    const vietnamese = sent[1].join("");
    assert.ok(english.startsWith(cacheNotice.en));
    assert.ok(english.includes("From the encrypted cache."));
    assert.ok(vietnamese.startsWith(cacheNotice.vi));
    assert.equal(vietnamese.includes(cacheNotice.en), false);
    for (const blobId of expectedIds) {
      assert.ok(english.includes(`Walrus blob: ${blobId}`));
      assert.ok(vietnamese.includes(`Walrus blob: ${blobId}`));
    }
    for (const blobId of [
      "cache-huge",
      "cache-extra",
      "cache-none",
      "cache-denied",
      "cache-queued",
      "cache-retired",
    ]) {
      assert.equal(english.includes(blobId), false);
      assert.equal(vietnamese.includes(blobId), false);
    }
    const visible = `${english}\n${vietnamese}\n${logs.lines.join("\n")}`;
    assert.equal(visible.includes("DATA_ENCRYPTION_KEY"), false);
    assert.equal(visible.includes("relayer secret"), false);
    assert.equal(visible.includes(query), false);
    assert.equal(store.list(user.id).some((entry) => entry.blobId === "cache-denied"), true);
  } finally {
    logs.restore();
    restore();
    store.db.close();
  }
});

test("503 and network recall failures use only eligible cached memories", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  for (const entry of cacheEntries()) store.insert(entry);
  const query = "lotus garden walk";
  const failures: unknown[] = [
    Object.assign(new Error("gateway timeout secret"), { status: 503 }),
    Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" }),
  ];
  let attempt = 0;
  const calls: string[][] = [];
  const f = fixture({
    store,
    memory: chatMemory(async () => {
      throw failures[attempt++];
    }),
    model: answeringModel(async (_question, _history, sources) => {
      calls.push(sources.map((source) => source.blobId));
      return "Cache still answered.";
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 213, query).expect(200);
    await Promise.all(f.jobs);
    await postUpdate(f.app, 214, query).expect(200);
    await Promise.all(f.jobs);
    const expected = [
      "cache-full-new",
      "cache-full-old",
      "cache-two-new",
      "cache-two-old",
    ];
    assert.deepEqual(calls, [expected, expected]);
    assert.equal(sent.join("").includes("gateway timeout secret"), false);
    assert.equal(sent.join("").includes("fetch failed"), false);
    assert.ok(sent.join("").includes(cacheNotice.en));
  } finally {
    restore();
    store.db.close();
  }
});

test("recall timeout with no cache returns a friendly answer without sources", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  store.insert(
    journal("hidden", {
      consent: false,
      memory: "lotus garden",
      blobId: "blob-not-allowed",
    }),
  );
  let late = false;
  const calls: Source[][] = [];
  const logs = captureConsole();
  const f = fixture({
    store,
    telegram: { recallTimeoutMs: 200 },
    memory: chatMemory(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            late = true;
            resolve({
              results: [
                recallHit(
                  journal("late", {
                    memory: "lotus garden",
                    blobId: "blob-arrived-too-late",
                  }),
                ),
              ],
            });
          }, 500);
        }),
    ),
    model: answeringModel(async (_question, history, sources) => {
      assert.deepEqual(history, []);
      calls.push(sources);
      return "No relevant memory was retrieved for this answer.";
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    const response = await Promise.race([
      postUpdate(f.app, 215, "lotus garden").expect(200),
      delay(150).then(() => {
        throw new Error("webhook waited for the recall timeout");
      }),
    ]);
    assert.equal(response.text, "");
    assert.equal(late, false);
    await Promise.all(f.jobs);
    assert.deepEqual(calls, [[]]);
    const joined = sent.join("");
    assert.ok(joined.startsWith(emptyRecallNotice.en));
    assert.ok(joined.includes("No relevant memory was retrieved for this answer."));
    assert.equal(joined.includes("Source "), false);
    assert.equal(joined.includes("blob-not-allowed"), false);
    assert.equal(joined.includes("blob-arrived-too-late"), false);
    assert.equal(joined.includes("recall_timeout"), false);
    assert.equal(logs.lines.join("\n").includes("lotus garden"), false);
    await delay(600);
    assert.equal(late, true);
    assert.equal(sent.join("").includes("blob-arrived-too-late"), false);
  } finally {
    logs.restore();
    restore();
    store.db.close();
  }
});

test("chat reports unavailable model without exposing raw errors", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  const secret = "DATA_ENCRYPTION_KEY sk-live-secret";
  const logs = captureConsole();
  let recalled = false;
  const unavailable = fixture({
    store,
    memory: chatMemory(async () => {
      recalled = true;
      throw new Error(secret);
    }),
    model: answeringModel(async () => {
      throw new Error(secret);
    }, false),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(unavailable.app, 216, `question ${secret}`).expect(200);
    await Promise.all(unavailable.jobs);
    assert.deepEqual(sent, [modelUnavailableNotice.en]);
    assert.equal(recalled, false);
    sent.length = 0;
    const failing = fixture({
      store,
      memory: chatMemory(async () => ({ results: [] })),
      model: answeringModel(async () => {
        const error = new Error(`LLM exploded ${secret}`);
        error.stack = `Error: LLM exploded ${secret}\n    at answer (llm.ts:1:1)`;
        throw error;
      }),
      background: (work) => unavailable.jobs.push(work),
    });
    await postUpdate(failing.app, 217, `question ${secret}`, "vi").expect(200);
    await Promise.all(unavailable.jobs);
    assert.deepEqual(sent, [modelFailedNotice.vi]);
    const visible = `${sent.join("\n")}\n${logs.lines.join("\n")}`;
    assert.equal(visible.includes(secret), false);
    assert.equal(visible.includes("LLM exploded"), false);
    assert.equal(visible.includes("llm.ts"), false);
    assert.equal(visible.includes("question "), false);
  } finally {
    logs.restore();
    restore();
    store.db.close();
  }
});

test("permanent recall failures do not cite the encrypted cache", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  store.insert(
    journal("kept", {
      memory: "lotus garden walk",
      blobId: "cache-should-stay-hidden",
    }),
  );
  const failures = [
    Object.assign(new Error("timeout talking to DATA_ENCRYPTION_KEY"), {
      status: 500,
    }),
    Object.assign(new Error("bad request DATA_ENCRYPTION_KEY"), { status: 400 }),
  ];
  let attempt = 0;
  let answered = false;
  const logs = captureConsole();
  const f = fixture({
    store,
    memory: chatMemory(async () => {
      throw failures[attempt++];
    }),
    model: answeringModel(async () => {
      answered = true;
      return "should not run";
    }),
  });
  const sent: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    sent.push(text);
    return {};
  });
  try {
    await postUpdate(f.app, 218, "lotus garden walk").expect(200);
    await Promise.all(f.jobs);
    await postUpdate(f.app, 219, "lotus garden walk", "vi").expect(200);
    await Promise.all(f.jobs);
    assert.deepEqual(sent, [recallFailedNotice.en, recallFailedNotice.vi]);
    assert.equal(answered, false);
    const visible = `${sent.join("\n")}\n${logs.lines.join("\n")}`;
    assert.equal(visible.includes("cache-should-stay-hidden"), false);
    assert.equal(visible.includes("DATA_ENCRYPTION_KEY"), false);
    assert.equal(visible.includes("lotus garden walk"), false);
  } finally {
    logs.restore();
    restore();
    store.db.close();
  }
});

test("telegram replies stay within 4096 code points and retain notices, emoji, and blob ids", async () => {
  const store = new Store(":memory:", randomBytes(32));
  linkedStore(store);
  const tulip = "🌷";
  assert.equal(tulip.length, 2);
  assert.equal(codePoints(tulip), 1);
  const blobId = `walrus_${"c".repeat(5000)}`;
  store.insert(
    journal("cached", {
      memory: "lotus garden",
      blobId,
    }),
  );
  let mode: "exact" | "over" | "ascii" | "ascii-over" | "fallback" = "exact";
  const f = fixture({
    store,
    memory: chatMemory(async () => {
      if (mode === "fallback")
        throw Object.assign(new Error("temporary gateway"), { status: 502 });
      return { results: [] };
    }),
    model: answeringModel(async () => {
      if (mode === "exact") return tulip.repeat(4096);
      if (mode === "over") return tulip.repeat(4097);
      if (mode === "ascii") return "a".repeat(4096);
      if (mode === "ascii-over") return "b".repeat(4097);
      return tulip.repeat(4097);
    }),
  });
  const batches: string[][] = [];
  let current: string[] = [];
  const restore = withSendMessage(async (_chatId, text) => {
    current.push(text);
    return {};
  });
  const send = async (updateId: number, text: string) => {
    current = [];
    await postUpdate(f.app, updateId, text).expect(200);
    await Promise.all(f.jobs);
    batches.push(current);
  };
  try {
    await send(220, "plain boundary");
    mode = "over";
    await send(221, "plain over");
    mode = "ascii";
    await send(222, "ascii boundary");
    mode = "ascii-over";
    await send(223, "ascii over");
    mode = "fallback";
    await send(224, "lotus garden");
    const [exact, over, ascii, asciiOver, fallback] = batches;
    assert.deepEqual(exact, [tulip.repeat(4096)]);
    assert.equal(codePoints(exact[0]), 4096);
    assert.deepEqual(over, [tulip.repeat(4096), tulip]);
    assert.deepEqual(ascii, ["a".repeat(4096)]);
    assert.deepEqual(asciiOver, ["b".repeat(4096), "b"]);
    const joined = fallback.join("");
    assert.ok(joined.startsWith(cacheNotice.en));
    assert.equal((joined.match(/🌷/gu) || []).length, 4097);
    assert.ok(joined.includes(`Source 1 · Walrus blob: ${blobId}`));
    assert.ok(fallback.every((text) => codePoints(text) <= 4096 && codePoints(text) > 0));
    assert.ok(joined.indexOf(cacheNotice.en) < joined.indexOf(tulip));
    assert.ok(joined.indexOf(tulip) < joined.indexOf("Source 1 · Walrus blob:"));
  } finally {
    restore();
    store.db.close();
  }
});

