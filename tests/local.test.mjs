import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  createProfile,
  localEnvironment,
  checkPort,
  pullModel,
} from "../scripts/local.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "walpen-setup-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("fresh profiles get distinct keys and no borrowed Walrus credentials", (t) => {
  const first = localEnvironment(createProfile(fixture(t)), {});
  const second = localEnvironment(createProfile(fixture(t), true), {});
  assert.notEqual(first.DATA_ENCRYPTION_KEY, second.DATA_ENCRYPTION_KEY);
  assert.equal(first.LLM_PROVIDER, "ollama");
  assert.equal(second.LLM_PROVIDER, "");
  assert.equal(first.MEMWAL_PRIVATE_KEY, "");
  assert.equal(first.HOST, "127.0.0.1");
});

test("rerunning setup preserves keys, user configuration and database bytes", (t) => {
  const directory = fixture(t);
  const file = createProfile(directory);
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace("PORT=3002", "PORT=3210"),
  );
  const before = readFileSync(file);
  writeFileSync(join(directory, "walpen.sqlite"), "existing database");
  createProfile(directory, true);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(
    readFileSync(join(directory, "walpen.sqlite"), "utf8"),
    "existing database",
  );
  assert.equal(localEnvironment(file, {}).PORT, "3210");
});

test("a missing or invalid key is never silently replaced", (t) => {
  const directory = fixture(t);
  const file = createProfile(directory);
  writeFileSync(file, "DATA_ENCRYPTION_KEY=bad\nPORT=3002\n");
  assert.throws(() => localEnvironment(file, {}), /original key/);
  writeFileSync(join(directory, "walpen.sqlite"), "encrypted data");
  unlinkSync(file);
  assert.throws(() => createProfile(directory), /Restore/);
});

test("local launcher isolates production configuration and derives safe bind/origin/database", (t) => {
  const file = createProfile(fixture(t), true);
  const env = localEnvironment(file, {
    PATH: "keep",
    MEMWAL_PRIVATE_KEY: "production-secret",
    MEMWAL_ACCOUNT_ID: "production-account",
    LLM_API_KEY: "production-token",
    APP_ORIGIN: "https://walpen.vercel.app",
    APP_MODE: "production",
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    INVITE_CODE: "private",
    DATABASE_PATH: "production.sqlite",
    DOTENV_CONFIG_OVERRIDE: "true",
    DOTENV_CONFIG_PATH: ".env",
    DOTENV_CONFIG_DEBUG: "true",
    DOTENV_KEY: "production-dotenv-key",
  });
  assert.equal(env.PATH, "keep");
  assert.equal(env.MEMWAL_PRIVATE_KEY, "");
  assert.equal(env.MEMWAL_ACCOUNT_ID, "");
  assert.equal(env.LLM_API_KEY, "");
  assert.equal(env.APP_MODE, "development");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.APP_ORIGIN, "http://localhost:3002");
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.INVITE_CODE, "");
  assert.equal(env.DOTENV_CONFIG_OVERRIDE, "false");
  assert.equal(env.DOTENV_CONFIG_PATH, file);
  assert.equal(env.DOTENV_CONFIG_DEBUG, undefined);
  assert.equal(env.DOTENV_KEY, undefined);
  assert.match(env.DATABASE_PATH, /walpen\.sqlite$/);
  assert.notEqual(env.DATABASE_PATH, "production.sqlite");
});

test("invalid ports, remote Ollama and partial MemWal credentials fail before launching", (t) => {
  const file = createProfile(fixture(t));
  const original = readFileSync(file, "utf8");
  for (const [before, after, message] of [
    ["PORT=3002", "PORT=NaN", /PORT/],
    ["http://127.0.0.1:11434", "https://example.com", /local HTTP/],
    ["MEMWAL_ACCOUNT_ID=", "MEMWAL_ACCOUNT_ID=account", /both/],
  ]) {
    writeFileSync(file, original.replace(before, after));
    assert.throws(() => localEnvironment(file, {}), message);
  }
});

test("an occupied port is rejected without stopping its listener", async (t) => {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  await assert.rejects(checkPort(server.address().port), /occupied/);
  assert.equal(server.listening, true);
});

test("model download requires a success receipt and surfaces stream errors", async () => {
  const respond = (body) => async () => new Response(body);
  await pullModel(
    "http://localhost:11434",
    "test",
    respond('{"status":"success"}\n'),
  );
  await assert.rejects(
    pullModel(
      "http://localhost:11434",
      "test",
      respond('{"status":"pulling"}\n'),
    ),
    /before confirmation/,
  );
  await assert.rejects(
    pullModel(
      "http://localhost:11434",
      "test",
      respond('{"error":"disk full"}\n'),
    ),
    /disk full/,
  );
});
