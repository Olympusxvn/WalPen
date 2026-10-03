import { MemWal } from "@mysten-incubation/memwal";
import type { Entry } from "./store.ts";
export interface MemoryRecall {
  results: { blob_id: string; text: string; distance?: unknown }[];
  total?: unknown;
  dropped_count?: unknown;
}
export interface MemoryGateway {
  configured: boolean;
  remember(entry: Entry): Promise<string>;
  wait(userId: string, jobId: string): Promise<string>;
  recall(userId: string, query: string): Promise<MemoryRecall>;
}
export class WalrusMemory implements MemoryGateway {
  configured = !!(
    process.env.MEMWAL_PRIVATE_KEY && process.env.MEMWAL_ACCOUNT_ID
  );
  client(userId: string) {
    if (!this.configured) throw new Error("Walrus chưa được cấu hình.");
    return MemWal.create({
      key: process.env.MEMWAL_PRIVATE_KEY!,
      accountId: process.env.MEMWAL_ACCOUNT_ID!,
      serverUrl:
        process.env.MEMWAL_SERVER_URL || "https://relayer.memory.walrus.xyz",
      namespace: `walpen-v1-${userId}`,
    });
  }
  async remember(e: Entry) {
    const result = await this.client(e.userId).remember(
      JSON.stringify({
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
      }),
    );
    return result.job_id;
  }
  async wait(userId: string, jobId: string) {
    const r = await this.client(userId).waitForRememberJob(jobId);
    return r.blob_id;
  }
  async recall(userId: string, query: string) {
    const r = await this.client(userId).recall({ query, limit: 20 });
    // Keep response metadata and raw distances. Filtering here would lose counts
    // before authorization; SDK maxDistance also rewrites total (MemWal #1066).
    return {
      results: r.results,
      total: r.total,
      dropped_count: r.dropped_count,
    };
  }
}
