import { applyTokenBudget, estimateTokens } from "@mysten-incubation/memwal";
import type { Source } from "./llm.ts";

// Uses the SDK estimator from MemWal PR #605, not an exact Qwen tokenizer.
export const MEMORY_TOKEN_BUDGET = 768;
export const MEMORY_SOURCE_LIMIT = 5;
export function serializeMemories(sources: Source[]) {
  return JSON.stringify(
    sources.map((s, i) => ({ reference: i + 1, text: s.text, date: s.date })),
  );
}

export function budgetMemoryContext(approved: Source[]) {
  const candidates = approved.slice(0, MEMORY_SOURCE_LIMIT);
  // Budget only authorized excerpts, never raw journal envelopes. Whole hits
  // preserve consent text, valid JSON and stable source references.
  const bounded = applyTokenBudget(
    candidates.map((source, index) => ({
      blob_id: source.blobId,
      text: JSON.stringify({
        reference: index + 1,
        text: source.text,
        date: source.date,
      }),
      distance: index,
    })),
    MEMORY_TOKEN_BUDGET - 8,
    "high-relevance-only",
  );
  const sources = candidates.slice(0, bounded.results.length);
  // Include array delimiters/reference metadata in the reported estimate.
  while (
    sources.length &&
    estimateTokens(serializeMemories(sources)) > MEMORY_TOKEN_BUDGET
  )
    sources.pop();
  return {
    sources,
    meta: {
      maxTokens: MEMORY_TOKEN_BUDGET,
      tokenEstimate: estimateTokens(serializeMemories(sources)),
      truncated: sources.length < approved.length,
      strategy: "high-relevance-only" as const,
      estimator: "memwal-chars-per-4" as const,
    },
  };
}
