import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Store, type Entry } from "../server/store.ts";

const newStore = () => new Store(":memory:", randomBytes(32));
const user = (id: string) => ({
  id,
  username: id,
  password: "not-a-real-password",
  createdAt: new Date(0).toISOString(),
});
const inbound = (updateId = 41) => ({
  updateId,
  telegramId: "123456123",
  chatId: "456789",
  text: "private telegram memory should never appear in plaintext",
  language: "en" as const,
});
const entry = (id = "entry-1"): Entry => ({
  id,
  userId: "user-1",
  rootId: id,
  revision: 1,
  supersedes: null,
  title: "Private note",
  body: "Sensitive journal text that must be encrypted",
  memory: "A private memory from Telegram",
  mood: "calm",
  consent: true,
  createdAt: new Date(1_000_000).toISOString(),
  occurredAt: new Date(1_000_000).toISOString(),
  status: "queued",
  jobId: null,
  blobId: null,
  error: null,
  retired: false,
});

test("link code expires and can only be consumed once", (t) => {
  const store = newStore();
  t.after(() => store.db.close());
  store.addUser(user("user-1"));

  assert.equal(
    store.issueTelegramLinkCode({
      telegramId: "123456123",
      codeHash: "digest-1",
      createdAt: 1_000_000,
      expiresAt: 1_600_000,
    }),
    true,
  );
  assert.equal(
    store.issueTelegramLinkCode({
      telegramId: "123456123",
      codeHash: "digest-2",
      createdAt: 1_059_999,
      expiresAt: 1_659_999,
    }),
    false,
  );
  assert.equal(
    store.consumeTelegramLinkCode("digest-1", "user-1", 1_600_000),
    "expired",
  );

  assert.equal(
    store.issueTelegramLinkCode({
      telegramId: "123456123",
      codeHash: "digest-3",
      createdAt: 1_700_000,
      expiresAt: 2_300_000,
    }),
    true,
  );
  assert.equal(
    store.consumeTelegramLinkCode("digest-3", "user-1", 1_700_001),
    "linked",
  );
  assert.equal(
    store.consumeTelegramLinkCode("digest-3", "user-1", 1_700_002),
    "invalid",
  );
});

test("telegram identity and WalPen user are one-to-one", (t) => {
  const store = newStore();
  t.after(() => store.db.close());
  store.addUser(user("user-1"));
  store.addUser(user("user-2"));
  store.issueTelegramLinkCode({
    telegramId: "123456001",
    codeHash: "digest-1",
    createdAt: 10_000,
    expiresAt: 610_000,
  });
  store.issueTelegramLinkCode({
    telegramId: "123456002",
    codeHash: "digest-2",
    createdAt: 10_000,
    expiresAt: 610_000,
  });
  store.issueTelegramLinkCode({
    telegramId: "123456003",
    codeHash: "digest-3",
    createdAt: 10_000,
    expiresAt: 610_000,
  });

  assert.equal(
    store.consumeTelegramLinkCode("digest-1", "user-1", 10_001),
    "linked",
  );
  assert.equal(
    store.consumeTelegramLinkCode("digest-2", "user-1", 10_002),
    "conflict",
  );
  assert.equal(
    store.consumeTelegramLinkCode("digest-3", "user-2", 10_003),
    "linked",
  );
  assert.equal(store.telegramUserId("123456001"), "user-1");
  assert.equal(store.telegramUserId("123456002"), undefined);
  assert.deepEqual(store.telegramLinkForUser("user-1"), {
    telegramId: "123456001",
    linkedAt: new Date(10_001).toISOString(),
  });
  assert.equal(store.telegramLinkForUser("user-2")?.telegramId, "123456003");
});

test("telegram update enqueue is encrypted and idempotent", (t) => {
  const store = newStore();
  t.after(() => store.db.close());
  const message = inbound();
  assert.deepEqual(store.enqueueTelegramUpdate(message, 100), {
    created: true,
    state: "queued",
  });
  assert.deepEqual(store.enqueueTelegramUpdate(message, 101), {
    created: false,
    state: "queued",
  });

  const raw = store.db
    .prepare(
      "SELECT payload_ciphertext FROM telegram_updates WHERE update_id=?",
    )
    .get(message.updateId) as { payload_ciphertext: string };
  assert.ok(!raw.payload_ciphertext.includes(message.text));
  assert.ok(!raw.payload_ciphertext.includes(message.telegramId));
});

test("telegram job claims reject active and completed replays", (t) => {
  const store = newStore();
  t.after(() => store.db.close());
  const message = inbound(52);
  store.enqueueTelegramUpdate(message, 1_000);

  assert.deepEqual(
    store.claimTelegramUpdate(message.updateId, 1_001, 361_000),
    message,
  );
  assert.equal(
    store.claimTelegramUpdate(message.updateId, 2_000, 362_000),
    undefined,
  );
  assert.deepEqual(
    store.claimTelegramUpdate(message.updateId, 361_000, 721_000),
    message,
  );
  store.finishTelegramUpdate(message.updateId, "done", 361_001);
  assert.equal(
    store.claimTelegramUpdate(message.updateId, 800_000, 1_160_000),
    undefined,
  );
});

test("telegram entry insertion is idempotent and encrypted", (t) => {
  const store = newStore();
  t.after(() => store.db.close());
  store.addUser(user("user-1"));
  const message = inbound(63);
  store.enqueueTelegramUpdate(message, 1_000);
  store.claimTelegramUpdate(message.updateId, 1_001, 361_000);

  const first = store.insertTelegramEntry(message.updateId, entry());
  const replay = store.insertTelegramEntry(
    message.updateId,
    entry("different-entry"),
  );
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.entry.id, "entry-1");
  assert.equal(store.get("entry-1", "user-1")?.body, entry().body);

  const rawEntry = store.db
    .prepare("SELECT payload FROM entries WHERE id=?")
    .get("entry-1") as { payload: string };
  assert.ok(!rawEntry.payload.includes(entry().body));
  const rawUpdate = store.db
    .prepare("SELECT entry_id FROM telegram_updates WHERE update_id=?")
    .get(message.updateId) as { entry_id: string };
  assert.equal(rawUpdate.entry_id, "entry-1");
});
