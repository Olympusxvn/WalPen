import { randomUUID } from "node:crypto";
import type { Entry } from "./store.ts";

export type WriteDraft = {
  accountId: string;
  serverUrl: string;
  namespace: string;
  text: string;
};
export type WriteIntent = WriteDraft & { key: string };
export type WriteLease = {
  intent: WriteIntent;
  token: string;
  attempts: number;
  firstAttemptAt: number;
  leaseUntil: number;
  nextAttemptAt: number;
};
export const WRITE_LEASE_MS = 10 * 60_000;
export const WRITE_BACKOFF_MS = 30_000;
export const WRITE_MAX_ATTEMPTS = 3;
export const writeUncertain =
  "Chưa xác nhận lần lưu trước. Dữ liệu vẫn được giữ; chỉ thử lại khi đủ điều kiện chống trùng.";
export const writeConflict =
  "Nội dung hoặc đích lưu đã thay đổi. Cần đối soát lần lưu trước trước khi tiếp tục.";

// This is an operator assertion of the relayer's verified retention window,
// not a discovery mechanism or a claim about the public relayer's guarantees.
export function retryWindow(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 86_400_000)
    throw new Error(
      "MEMWAL_IDEMPOTENCY_RETRY_WINDOW_MS must be an integer from 0 to 86400000",
    );
  return ms;
}
export function serializeMemory(e: Entry): string {
  return JSON.stringify({
    schema: "walpen/v1",
    id: e.id,
    rootId: e.rootId,
    revision: e.revision,
    supersedes: e.supersedes,
    title: e.title,
    body: e.body,
    memory: e.memory,
    mood: e.mood,
    consent: e.consent,
    occurredAt: e.occurredAt,
    recordedAt: e.createdAt,
  });
}
export function sameDraft(a: WriteDraft, b: WriteDraft): boolean {
  return (
    a.accountId === b.accountId &&
    a.serverUrl === b.serverUrl &&
    a.namespace === b.namespace &&
    a.text === b.text
  );
}
export function canRetry(
  w: WriteLease,
  windowMs: number,
  now: number,
): boolean {
  return (
    windowMs > 0 &&
    now >= w.firstAttemptAt &&
    now < w.firstAttemptAt + windowMs &&
    w.attempts < WRITE_MAX_ATTEMPTS &&
    now >= w.leaseUntil &&
    now >= w.nextAttemptAt
  );
}
/** Must run while the entry row is locked, in the same transaction as persistence. */
export function nextLease(
  e: Entry,
  old: WriteLease | undefined,
  draft: WriteDraft,
  windowMs: number,
  now: number,
): WriteLease | undefined {
  if (
    e.retired ||
    e.jobId ||
    !["queued", "submitting", "uncertain"].includes(e.status)
  )
    return;
  if (draft.text !== serializeMemory(e)) throw new Error(writeConflict);
  if (old && !sameDraft(old.intent, draft)) throw new Error(writeConflict);
  if (old ? !canRetry(old, windowMs, now) : e.status !== "queued") return;
  return {
    intent: old?.intent ?? { ...draft, key: randomUUID() },
    token: randomUUID(),
    attempts: (old?.attempts ?? 0) + 1,
    firstAttemptAt: old?.firstAttemptAt ?? now,
    leaseUntil: now + WRITE_LEASE_MS,
    nextAttemptAt: now + WRITE_BACKOFF_MS * ((old?.attempts ?? 0) + 1),
  };
}
export function decodeLease(
  row: any,
  decrypt: (payload: string) => any,
): WriteLease | undefined {
  if (!row) return;
  return {
    intent: { ...decrypt(row.payload), key: row.idempotencyKey },
    token: row.leaseToken,
    attempts: Number(row.attempts),
    firstAttemptAt: Number(row.firstAttemptAt),
    leaseUntil: Number(row.leaseUntil),
    nextAttemptAt: Number(row.nextAttemptAt),
  };
}
