import type { Entry } from "./store.ts";
import type { Repository } from "./repository.ts";
import type { MemoryGateway } from "./memory.ts";
import {
  writeConflict,
  writeUncertain,
  type WriteLease,
} from "./write-intent.ts";

/** Every write must have a committed intent; process-local locks are only an optimization. */
export async function synchronize(
  store: Repository,
  memory: MemoryGateway,
  entry: Entry,
  windowMs: number,
  now = Date.now(),
) {
  const started = Date.now();
  const e = await store.get(entry.id, entry.userId);
  if (!e || !memory.configured || ["synced", "failed"].includes(e.status))
    return;
  let jobId = e.jobId;
  let lease: WriteLease | undefined;
  let claimed = false;
  let receipt: string | undefined;
  try {
    if (!jobId) {
      lease = await store.claim(e.id, memory.prepare(e), windowMs, now);
      if (!lease) return;
      claimed = true;
      // Recheck after the claim: a concurrent edit/withdrawal may retire this revision.
      // A request already in flight cannot be undone; it may only be polled later.
      if ((await store.get(e.id, e.userId))?.retired) return;
      const sendingAt = now + Math.max(0, Date.now() - started);
      if (
        sendingAt >= lease.leaseUntil ||
        (lease.attempts > 1 && sendingAt >= lease.firstAttemptAt + windowMs)
      ) {
        await store.sync(
          e.id,
          "uncertain",
          null,
          null,
          writeUncertain,
          lease.token,
        );
        return;
      }
      jobId = await memory.remember(e, lease.intent);
      if (!(await store.sync(e.id, "pending", jobId, null, null, lease.token)))
        return;
    } else {
      lease = await store.writeIntent(e.id);
    }
    receipt = await memory.wait(e.userId, jobId, lease?.intent);
    await store.sync(
      e.id,
      "synced",
      jobId,
      receipt,
      null,
      claimed ? lease?.token : undefined,
    );
  } catch (err) {
    if (receipt && jobId) {
      await store.sync(
        e.id,
        "synced",
        jobId,
        receipt,
        null,
        claimed ? lease?.token : undefined,
      );
      return;
    }
    // A failed commit means no permission to send. Leave queued entries queued.
    if (!claimed && !jobId) {
      if (err instanceof Error && err.message === writeConflict) {
        const current = await store.writeIntent(e.id);
        await store.sync(
          e.id,
          "uncertain",
          null,
          null,
          writeConflict,
          current?.token,
        );
        return;
      }
      throw err;
    }
    const failed =
      err instanceof Error && err.message.startsWith("remember job failed:");
    await store.sync(
      e.id,
      failed ? "failed" : jobId ? "pending" : "uncertain",
      jobId,
      null,
      err instanceof Error && err.message === writeConflict
        ? writeConflict
        : failed
          ? "Walrus báo job thất bại. Bản cục bộ còn nguyên; cần kiểm tra job trước khi lưu lại."
          : jobId
            ? "Walrus chưa xác nhận hoàn tất. Bạn có thể kiểm tra lại job hiện tại."
            : writeUncertain,
      claimed ? lease?.token : undefined,
    );
  }
}
