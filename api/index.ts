import { Pool } from "pg";
import { attachDatabasePool, waitUntil } from "@vercel/functions";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PostgresStore } from "../server/postgres-store.ts";
import { createApp } from "../server/app.ts";
import { WalrusMemory } from "../server/memory.ts";
import { LocalModel } from "../server/llm.ts";

let runtime:
  | { store: PostgresStore; app: ReturnType<typeof createApp>["app"] }
  | undefined;
function getRuntime() {
  if (runtime) return runtime;
  const { DATABASE_URL, DATA_ENCRYPTION_KEY, APP_ORIGIN, INVITE_CODE } =
    process.env;
  if (
    !DATABASE_URL ||
    !DATA_ENCRYPTION_KEY ||
    !/^[a-f\d]{64}$/i.test(DATA_ENCRYPTION_KEY) ||
    !APP_ORIGIN?.startsWith("https://") ||
    !INVITE_CODE
  ) {
    throw new Error("Cloud environment is incomplete.");
  }
  if (process.env.LLM_PROVIDER === "ollama")
    throw new Error("Cloud deployment requires an online AI provider or BYOK.");
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 15000,
  });
  attachDatabasePool(pool);
  const store = new PostgresStore(
    pool,
    Buffer.from(DATA_ENCRYPTION_KEY, "hex"),
  );
  const { app } = createApp(store, new WalrusMemory(), new LocalModel(), {
    production: true,
    origin: APP_ORIGIN,
    inviteCode: INVITE_CODE,
    trustProxy: 1,
    background: waitUntil,
  });
  return (runtime = { store, app });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const { store, app } = getRuntime();
    await store.init();
    app(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: "Cloud API is not ready. Please try again shortly.",
      }),
    );
  }
}
