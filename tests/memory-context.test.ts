import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "@mysten-incubation/memwal";
import {
  budgetMemoryContext,
  serializeMemories,
  MEMORY_TOKEN_BUDGET,
} from "../server/memory-context.ts";
import type { Source } from "../server/llm.ts";
const source = (id: string, text: string): Source => ({
  id,
  blobId: `blob-${id}`,
  title: id,
  text,
  date: "2026-09-29T00:00:00.000Z",
});

test("SDK whole-hit budget covers the exact serialized memory payload without altering excerpts", () => {
  const input = [
    source("a", "🌿 Việt Nam ".repeat(120)),
    source("b", "B".repeat(1800)),
    source("c", "A short fact"),
  ];
  const snapshot = JSON.stringify(input);
  const result = budgetMemoryContext(input);
  assert.ok(result.sources.length > 0 && result.sources.length < input.length);
  assert.equal(result.meta.truncated, true);
  assert.ok(result.meta.tokenEstimate <= MEMORY_TOKEN_BUDGET);
  assert.equal(
    result.meta.tokenEstimate,
    estimateTokens(serializeMemories(result.sources)),
  );
  assert.equal(JSON.stringify(input), snapshot);
  result.sources.forEach((value, index) =>
    assert.deepEqual(value, input[index]),
  );
  const envelope = JSON.parse(serializeMemories(result.sources));
  assert.equal(envelope[0].reference, 1);
  assert.equal(envelope[0].text, input[0].text);
});

test("oversized leading memory is omitted whole; an empty set has no invented sources", () => {
  const result = budgetMemoryContext([
    source("huge", "x".repeat(10000)),
    source("small", "fact"),
  ]);
  assert.equal(result.sources.length, 0);
  assert.equal(result.meta.truncated, true);
  assert.deepEqual(budgetMemoryContext([]).sources, []);
  assert.equal(budgetMemoryContext([]).meta.truncated, false);
});

test("source cap is included in omission metadata and retained citations stay ordered", () => {
  const result = budgetMemoryContext(
    Array.from({ length: 7 }, (_, i) => source(String(i), `fact ${i}`)),
  );
  assert.equal(result.sources.length, 5);
  assert.equal(result.meta.truncated, true);
  assert.deepEqual(
    JSON.parse(serializeMemories(result.sources)).map((s: any) => s.reference),
    [1, 2, 3, 4, 5],
  );
});
