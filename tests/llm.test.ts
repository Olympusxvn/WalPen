import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalModel } from "../server/llm.ts";
test("BYOK credentials remain isolated between concurrent requests", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const seen: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(
      String(url).startsWith("https://generativelanguage.googleapis.com/"),
    );
    seen.push(new Headers(init?.headers).get("x-goog-api-key")!);
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: "A real provider response shape." }] },
            finishReason: "STOP",
          },
        ],
      }),
    );
  };
  await Promise.all(
    ["key-for-first-user", "key-for-second-user"].map((apiKey) =>
      new LocalModel({
        provider: "gemini",
        apiKey,
        model: "test-model",
      }).answer("Hi", [], []),
    ),
  );
  assert.deepEqual(seen.sort(), ["key-for-first-user", "key-for-second-user"]);
});
test("Ollama receives the selected language and instruct models do not request thinking", async (t) => {
  const fetchBefore = globalThis.fetch,
    provider = process.env.LLM_PROVIDER,
    model = process.env.LLM_MODEL;
  t.after(() => {
    globalThis.fetch = fetchBefore;
    if (provider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = provider;
    if (model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = model;
  });
  process.env.LLM_PROVIDER = "ollama";
  process.env.LLM_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
  let payload: any;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        message: { content: "A gentle English answer." },
        done_reason: "stop",
      }),
      { status: 200 },
    );
  };
  const llm = new LocalModel();
  assert.equal(
    await llm.answer("Hello", [], [], "en"),
    "A gentle English answer.",
  );
  assert.ok(payload.messages[0].content.includes("Reply in English"));
  assert.equal(payload.think, undefined);
  assert.equal(payload.stream, false);
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: { content: "No saved memory [1]." },
        done_reason: "stop",
      }),
    );
  assert.equal(await llm.answer("Hello", [], [], "en"), "No saved memory.");
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: { content: "A walk helps [1]. Extra reference [2]." },
        done_reason: "stop",
      }),
    );
  assert.equal(
    await llm.answer(
      "Hello",
      [],
      [
        {
          id: "a",
          title: "Walk",
          text: "A walk helps",
          date: "2026-09-19",
          blobId: "blob",
        },
      ],
      "en",
    ),
    "A walk helps [1]. Extra reference.",
  );
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: { content: "unfinished reasoning" },
        done_reason: "length",
      }),
      { status: 200 },
    );
  await assert.rejects(
    () => llm.answer("Hello", [], [], "vi"),
    /chưa hoàn tất/,
  );
});
