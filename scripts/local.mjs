import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultModel = "qwen3:4b-instruct-2507-q4_K_M";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function createProfile(directory, noAI = false) {
  const file = resolve(directory, ".env");
  mkdirSync(directory, { recursive: true });
  if (!existsSync(file)) {
    if (existsSync(resolve(directory, "walpen.sqlite"))) {
      throw new Error(
        "Local database exists without its key. Restore data/local/.env from your backup; do not generate a replacement key.",
      );
    }
    writeFileSync(
      file,
      [
        "# Private local profile. Keep this file with your database backup.",
        "PORT=3002",
        `DATA_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
        `LLM_PROVIDER=${noAI ? "" : "ollama"}`,
        `LLM_MODEL=${defaultModel}`,
        "LLM_BASE_URL=http://127.0.0.1:11434",
        "MEMWAL_ACCOUNT_ID=",
        "MEMWAL_PRIVATE_KEY=",
        "MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz",
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );
  }
  return file;
}

export function localEnvironment(file, inherited = process.env) {
  const config = parseEnv(readFileSync(file, "utf8"));
  if (!/^[a-f\d]{64}$/i.test(config.DATA_ENCRYPTION_KEY || "")) {
    throw new Error(
      "Invalid DATA_ENCRYPTION_KEY in data/local/.env. Restore the original key; setup will not replace it.",
    );
  }
  const port = Number(config.PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      "Set PORT in data/local/.env to an integer from 1024 to 65535.",
    );
  }
  if (config.LLM_PROVIDER && config.LLM_PROVIDER !== "ollama") {
    throw new Error("Local setup supports LLM_PROVIDER=ollama or blank.");
  }
  const base = new URL(config.LLM_BASE_URL || "http://127.0.0.1:11434");
  if (
    base.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  ) {
    throw new Error(
      "LLM_BASE_URL must be a local HTTP Ollama origin, e.g. http://127.0.0.1:11434.",
    );
  }
  if (
    Boolean(config.MEMWAL_ACCOUNT_ID) !== Boolean(config.MEMWAL_PRIVATE_KEY)
  ) {
    throw new Error(
      "Set both MEMWAL_ACCOUNT_ID and MEMWAL_PRIVATE_KEY, or leave both blank.",
    );
  }
  const env = { ...inherited };
  // Do not inherit production credentials, dotenv overrides, or server settings.
  for (const key of Object.keys(env)) {
    if (
      /^(MEMWAL_|LLM_|DOTENV_|DATA_ENCRYPTION_KEY$|DATABASE_PATH$|PORT$|HOST$|APP_|NODE_ENV$|INVITE_CODE$)/i.test(
        key,
      )
    )
      delete env[key];
  }
  Object.assign(env, {
    PORT: String(port),
    HOST: "127.0.0.1",
    APP_MODE: "development",
    NODE_ENV: "development",
    APP_ORIGIN: `http://localhost:${port}`,
    INVITE_CODE: "",
    DATA_ENCRYPTION_KEY: config.DATA_ENCRYPTION_KEY,
    DATABASE_PATH: resolve(dirname(file), "walpen.sqlite"),
    DOTENV_CONFIG_PATH: file,
    DOTENV_CONFIG_QUIET: "true",
    DOTENV_CONFIG_OVERRIDE: "false",
    LLM_PROVIDER: config.LLM_PROVIDER || "",
    LLM_API_KEY: "",
    LLM_MODEL: config.LLM_MODEL || defaultModel,
    LLM_BASE_URL: base.origin,
    MEMWAL_ACCOUNT_ID: config.MEMWAL_ACCOUNT_ID || "",
    MEMWAL_PRIVATE_KEY: config.MEMWAL_PRIVATE_KEY || "",
    MEMWAL_SERVER_URL:
      config.MEMWAL_SERVER_URL || "https://relayer.memory.walrus.xyz",
  });
  return env;
}

export async function checkPort(port) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop your own local instance, or change PORT in data/local/.env. No existing process was stopped.`,
        ),
      ),
    );
    server.listen(Number(port), "127.0.0.1", () => server.close(done));
  });
}

function run(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? done()
        : reject(new Error(`${command} stopped (${signal || code}).`)),
    );
  });
}

async function tags(base) {
  const response = await fetch(`${base}/api/tags`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  return response.json();
}

export async function pullModel(base, model, fetcher = fetch) {
  console.log(
    `Downloading ${model}. This may take several minutes; existing model files are reused.`,
  );
  const response = await fetcher(`${base}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, stream: true }),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Model download failed (HTTP ${response.status}).`);
  const lines = createInterface({
    input: Readable.fromWeb(response.body),
    crlfDelay: Infinity,
  });
  let success = false,
    lastStatus = "",
    lastProgress = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.error) throw new Error(`Ollama: ${event.error}`);
    if (event.status === "success") success = true;
    if (event.status !== lastStatus || Date.now() - lastProgress > 10000) {
      console.log(
        `  ${event.status || "downloading"}${event.total ? ` (${Math.floor((100 * (event.completed || 0)) / event.total)}%)` : ""}`,
      );
      lastStatus = event.status;
      lastProgress = Date.now();
    }
  }
  if (!success)
    throw new Error(
      "Model download ended before confirmation. Run setup again to resume.",
    );
}

async function ensureOllama(env, directory) {
  let available;
  try {
    available = await tags(env.LLM_BASE_URL);
  } catch {
    console.log("Starting installed Ollama. Logs: data/local/ollama.log");
    const log = openSync(resolve(directory, "ollama.log"), "a");
    const child = spawn("ollama", ["serve"], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, OLLAMA_HOST: new URL(env.LLM_BASE_URL).host },
    });
    closeSync(log);
    let launchError;
    child.once("error", (error) => {
      launchError = error;
    });
    child.unref();
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(500);
      if (launchError) break;
      try {
        available = await tags(env.LLM_BASE_URL);
        break;
      } catch {
        /* wait for startup */
      }
    }
    if (!available)
      throw new Error(
        "Ollama is unavailable. Install/open it from https://ollama.com/download, then retry. For journal-only setup use --no-ai on a fresh profile, or blank LLM_PROVIDER in data/local/.env.",
      );
  }
  if (
    !available.models?.some(
      (item) => item.name === env.LLM_MODEL || item.model === env.LLM_MODEL,
    )
  ) {
    await pullModel(env.LLM_BASE_URL, env.LLM_MODEL);
  }
  console.log(`Ollama model ready: ${env.LLM_MODEL}`);
}

async function start(env) {
  if (
    !existsSync(resolve(root, "dist/index.html")) ||
    !existsSync(resolve(root, "node_modules/tsx"))
  ) {
    throw new Error(
      "Dependencies or build missing. Run npm run setup:local first.",
    );
  }
  await checkPort(env.PORT);
  console.log(
    `Starting WalPen at ${env.APP_ORIGIN}. Keep this terminal open; Ctrl+C stops WalPen.`,
  );
  console.log(
    env.MEMWAL_PRIVATE_KEY
      ? "Walrus enabled: saving entries can write to Mainnet."
      : "Walrus disabled: journal stays local; chat has no Walrus recall or blob receipts.",
  );
  await run(process.execPath, ["--import", "tsx", "server/index.ts"], { env });
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error(
      "WalPen requires Node.js 24.x. Install it from https://nodejs.org/download and reopen your terminal.",
    );
  const [command, ...flags] = process.argv.slice(2);
  if (
    !["setup", "start"].includes(command) ||
    flags.some((flag) => !["--no-ai", "--no-start"].includes(flag)) ||
    (command === "start" && flags.length)
  ) {
    throw new Error(
      "Usage: node scripts/local.mjs setup [--no-ai] [--no-start] | start",
    );
  }
  const directory = resolve(root, "data/local");
  const file = resolve(directory, ".env");
  if (command === "setup") {
    const existing = existsSync(file);
    createProfile(directory, flags.includes("--no-ai"));
    console.log(
      existing
        ? "Keeping existing data/local/.env, key and database unchanged."
        : "Created private configuration at data/local/.env.",
    );
    if (existing && flags.includes("--no-ai"))
      console.log(
        "--no-ai only applies to a new profile. To disable existing AI, blank LLM_PROVIDER in data/local/.env.",
      );
  } else if (!existsSync(file))
    throw new Error("No local profile. Run npm run setup:local first.");
  const env = localEnvironment(file);
  if (command === "setup") {
    await checkPort(env.PORT);
    if (env.LLM_PROVIDER) await ensureOllama(env, directory);
    const buildEnv = { ...env, NODE_ENV: "production" };
    if (process.env.npm_execpath) {
      await run(
        process.execPath,
        [process.env.npm_execpath, "ci", "--include=dev"],
        { env },
      );
      await run(process.execPath, [process.env.npm_execpath, "run", "build"], {
        env: buildEnv,
      });
    } else if (process.platform === "win32") {
      // Fixed commands only; no user input is interpolated into cmd.exe.
      await run("cmd.exe", ["/d", "/s", "/c", "npm ci --include=dev"], { env });
      await run("cmd.exe", ["/d", "/s", "/c", "npm run build"], {
        env: buildEnv,
      });
    } else {
      await run("npm", ["ci", "--include=dev"], { env });
      await run("npm", ["run", "build"], { env: buildEnv });
    }
    console.log("Setup complete. Start later with: npm run start:local");
    if (flags.includes("--no-start")) return;
  }
  await start(env);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`\nLocal setup: ${error.message}`);
    process.exitCode = 1;
  });
}
