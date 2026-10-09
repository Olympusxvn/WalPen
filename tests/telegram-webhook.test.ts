import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Telegram } from "telegraf";
import request from "supertest";
import { createApp } from "../server/app.ts";
import type { ChatModel } from "../server/llm.ts";
import type { MemoryGateway } from "../server/memory.ts";
import type { Repository } from "../server/repository.ts";
import { hash, Store } from "../server/store.ts";
import { serializeMemory } from "../server/write-intent.ts";

const config = {
  botToken: "123456789:telegram-test-token",
  webhookSecret: "telegram_test_secret_123",
  appOrigin: "https://walpen.example",
  recallTimeoutMs: 8_000,
};
const update = (updateId: number, text = "/start") => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    from: {
      id: 123456789,
      is_bot: false,
      first_name: "Judge",
      language_code: "en",
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
  } = {},
) {
  const store = options.store ?? new Store(":memory:", randomBytes(32));
  const jobs: Promise<unknown>[] = [];
  const { app } = createApp(store, options.memory ?? memory, model, {
    rateLimits: false,
    telegram: config,
    background: options.background ?? ((work) => jobs.push(work)),
  });
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

