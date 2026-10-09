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
  } = {},
) {
  const store = options.store ?? new Store(":memory:", randomBytes(32));
  const jobs: Promise<unknown>[] = [];
  const { app } = createApp(store, memory, model, {
    rateLimits: false,
    telegram: config,
    background: options.background ?? ((work) => jobs.push(work)),
  });
  return { app, store, jobs };
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

