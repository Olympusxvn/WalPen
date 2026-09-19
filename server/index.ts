import "dotenv/config";
import express from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Store } from "./store.ts";
import { WalrusMemory } from "./memory.ts";
import { LocalModel } from "./llm.ts";
import { createApp } from "./app.ts";
const secret = process.env.DATA_ENCRYPTION_KEY;
if (!secret || !/^[a-f\d]{64}$/i.test(secret))
  throw new Error(
    "Set DATA_ENCRYPTION_KEY to 64 random hex characters in .env. See README.",
  );
const production =
  process.env.APP_MODE === "production" ||
  process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.APP_ORIGIN?.startsWith("https://") || !process.env.INVITE_CODE)
)
  throw new Error("Production requires HTTPS APP_ORIGIN and INVITE_CODE.");
const store = new Store(
  process.env.DATABASE_PATH || "data/walpen.sqlite",
  Buffer.from(secret, "hex"),
);
const { app, resume } = createApp(store, new WalrusMemory(), new LocalModel(), {
  production,
  origin: process.env.APP_ORIGIN,
  inviteCode: process.env.INVITE_CODE,
});
if (existsSync("dist/index.html")) {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
}
const port = Number(process.env.PORT) || 3001;
app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`WalPen ready at http://localhost:${port}`);
  resume();
});
setInterval(resume, 60000).unref();
