import type { Entry } from "./store.ts";
import type { Source } from "./llm.ts";
import type { MemoryRecall } from "./memory.ts";
import type { RecallDiagnostics } from "../shared/recall.ts";
import { budgetMemoryContext } from "./memory-context.ts";

export const DEFAULT_RECALL_MAX_DISTANCE = 0.7;

export function recallMaxDistance(value: string | undefined): number | null {
  if (value === undefined || !value.trim()) return DEFAULT_RECALL_MAX_DISTANCE;
  if (value.trim().toLowerCase() === "off") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 2)
    throw new Error(
      "MEMWAL_RECALL_MAX_DISTANCE must be a number in (0, 2] or off.",
    );
  return parsed;
}

export function emptyRecallDiagnostics(
  maxDistance: number | null,
  status: RecallDiagnostics["status"],
): RecallDiagnostics {
  return {
    status,
    maxDistance,
    returnedCount: null,
    upstreamTotal: null,
    upstreamDropped: null,
    authorizationRejected: 0,
    invalidDistance: 0,
    relevanceRejected: 0,
    duplicates: 0,
    eligibleCount: 0,
    budgetOmitted: 0,
    usedCount: 0,
    reasons: [],
  };
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function selectRecallContext(
  remote: MemoryRecall,
  entries: Entry[],
  maxDistance: number | null,
) {
  const diagnostics = emptyRecallDiagnostics(maxDistance, "empty");
  diagnostics.returnedCount = remote.results.length;
  diagnostics.upstreamTotal = count(remote.total);
  // Missing metadata stays unknown, even if an SDK documents omission for zero.
  diagnostics.upstreamDropped = count(remote.dropped_count);
  const active = new Map(
    entries
      .filter((e) => !e.retired && e.consent && e.status === "synced")
      .map((e) => [e.blobId, e]),
  );
  const seen = new Set<string>();
  const approved: Source[] = [];
  for (const hit of remote.results) {
    const entry = active.get(hit.blob_id);
    let record: unknown;
    try {
      record = JSON.parse(hit.text);
    } catch {
      record = null;
    }
    if (
      !entry ||
      !record ||
      typeof record !== "object" ||
      !("schema" in record) ||
      record.schema !== "walpen/v1" ||
      !("id" in record) ||
      record.id !== entry.id ||
      !("consent" in record) ||
      record.consent !== true ||
      !("memory" in record) ||
      typeof record.memory !== "string" ||
      record.memory !== entry.memory
    ) {
      diagnostics.authorizationRejected++;
      continue;
    }
    const distance = hit.distance;
    // Default SDK ranking uses cosine distance. Missing/invalid scores fail closed,
    // including when the relevance threshold is explicitly disabled.
    if (
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      distance < 0 ||
      distance > 2
    ) {
      diagnostics.invalidDistance++;
      continue;
    }
    // Match SDK maxDistance's strict boundary without its destructive total rewrite.
    if (maxDistance !== null && distance >= maxDistance) {
      diagnostics.relevanceRejected++;
      continue;
    }
    if (seen.has(entry.id)) {
      diagnostics.duplicates++;
      continue;
    }
    seen.add(entry.id);
    approved.push({
      id: entry.id,
      title: entry.title || "Một trang nhật ký",
      text: record.memory,
      date: entry.occurredAt,
      blobId: hit.blob_id,
    });
  }
  const context = budgetMemoryContext(approved);
  diagnostics.eligibleCount = approved.length;
  diagnostics.usedCount = context.sources.length;
  diagnostics.budgetOmitted = approved.length - context.sources.length;
  diagnostics.status = context.sources.length ? "used" : "empty";
  if (!remote.results.length && !diagnostics.upstreamDropped)
    diagnostics.reasons.push("no_matches");
  if (diagnostics.authorizationRejected)
    diagnostics.reasons.push("authorization_rejected");
  if (diagnostics.invalidDistance) diagnostics.reasons.push("invalid_distance");
  if (diagnostics.relevanceRejected)
    diagnostics.reasons.push("relevance_rejected");
  if (diagnostics.upstreamDropped) diagnostics.reasons.push("upstream_dropped");
  if (diagnostics.budgetOmitted) diagnostics.reasons.push("budget_omitted");
  return { ...context, diagnostics };
}
