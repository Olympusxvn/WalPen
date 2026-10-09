import { randomBytes, randomUUID } from "node:crypto";
import { Telegraf } from "telegraf";
import type { ChatModel } from "../llm.ts";
import type { MemoryGateway } from "../memory.ts";
import type { Repository, TelegramInboundJob } from "../repository.ts";
import { hash, type Entry } from "../store.ts";
import { synchronize } from "../synchronize.ts";

export interface TelegramChannelConfig {
  botToken: string;
  webhookSecret: string;
  appOrigin: string;
  recallTimeoutMs: number;
}
export interface TelegramChannelDependencies {
  store: Repository;
  memory: MemoryGateway;
  model: ChatModel;
  background(work: Promise<unknown>): void;
  recallMaxDistance: number | null;
  retryWindowMs: number;
}
export type TelegramBot = Telegraf & {
  processTelegramJob(updateId: number): Promise<void>;
  resumeTelegramJobs(maxJobs: number): Promise<void>;
};

const telegramLeaseMs = 360_000;
const codeLifetimeMs = 10 * 60_000;
const retryDelayMs = 30_000;
const maxWriteCharacters = 4_000;

export function telegramConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TelegramChannelConfig | undefined {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (
    !botToken ||
    !webhookSecret ||
    !/^\d+:[A-Za-z0-9_-]+$/.test(botToken) ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)
  )
    return undefined;
  const timeout = Number(env.TELEGRAM_RECALL_TIMEOUT_MS ?? 8_000);
  return {
    botToken,
    webhookSecret,
    appOrigin:
      env.APP_ORIGIN?.trim().replace(/\/+$/, "") ||
      "http://localhost:" + (env.PORT || "3001"),
    recallTimeoutMs:
      Number.isFinite(timeout) && timeout >= 250 && timeout <= 120_000
        ? Math.trunc(timeout)
        : 8_000,
  };
}

function languageFor(languageCode?: string): "en" | "vi" {
  return languageCode?.toLowerCase().startsWith("en") ? "en" : "vi";
}
function isStart(text: string): boolean {
  return /^\/start(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}
function isWrite(text: string): boolean {
  return /^\/write(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}
function writeBody(text: string): string {
  return text
    .trim()
    .replace(/^\/write(?:@[\w_]+)?/i, "")
    .trim();
}
function localized(job: TelegramInboundJob, en: string, vi: string): string {
  return job.language === "en" ? en : vi;
}
function writeEntry(userId: string, body: string): Entry {
  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    userId,
    rootId: id,
    revision: 1,
    supersedes: null,
    title: "Telegram journal",
    body,
    memory: body,
    mood: "🌿",
    consent: true,
    createdAt: now,
    occurredAt: now,
    status: "queued",
    jobId: null,
    blobId: null,
    error: null,
    retired: false,
  };
}
export function telegramJobFromUpdate(
  update: unknown,
): TelegramInboundJob | undefined {
  if (!update || typeof update !== "object") return undefined;
  const value = update as any;
  const message = value.message;
  if (
    !message ||
    message.chat?.type !== "private" ||
    !message.from ||
    message.from.is_bot
  )
    return undefined;
  return safeTelegramJob({
    updateId: value.update_id,
    telegramId: String(message.from.id ?? ""),
    chatId: String(message.chat.id ?? ""),
    text: message.text,
    language: languageFor(message.from.language_code),
  });
}
function safeTelegramJob(input: unknown): TelegramInboundJob | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as TelegramInboundJob;
  if (
    !Number.isSafeInteger(value.updateId) ||
    value.updateId < 0 ||
    !/^\d{1,24}$/.test(String(value.telegramId)) ||
    !/^-?\d{1,24}$/.test(String(value.chatId)) ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    Array.from(value.text).length > 4096 ||
    (value.language !== "en" && value.language !== "vi")
  )
    return undefined;
  return {
    updateId: value.updateId,
    telegramId: String(value.telegramId),
    chatId: String(value.chatId),
    text: value.text,
    language: value.language,
  };
}

export function createTelegramBot(
  deps: TelegramChannelDependencies,
  config: TelegramChannelConfig,
): TelegramBot {
  const bot = new Telegraf(config.botToken);
  // A webhook does not need getMe(); avoiding it keeps the first request local.
  bot.botInfo = {
    id: Number(config.botToken.split(":", 1)[0]) || 0,
    is_bot: true,
    first_name: "WalPen",
    username: "walpen_bot",
  } as any;

  const processTelegramJob = async (updateId: number): Promise<void> => {
    const now = Date.now();
    const job = await deps.store.claimTelegramUpdate(
      updateId,
      now,
      now + telegramLeaseMs,
    );
    if (!job) return;
    try {
      if (isStart(job.text)) {
        await bot.telegram.sendMessage(
          job.chatId,
          await startMessage(job, deps.store, config, now),
        );
      } else if (isWrite(job.text)) {
        await processWrite(job, updateId, deps, bot);
      } else {
        await bot.telegram.sendMessage(
          job.chatId,
          localized(
            job,
            "I’m getting WalPen ready. Send /start to connect your Telegram account.",
            "WalPen đang khởi động. Gửi /start để liên kết tài khoản Telegram.",
          ),
        );
      }
      await deps.store.finishTelegramUpdate(updateId, "done", Date.now());
    } catch {
      try {
        await deps.store.releaseTelegramUpdate(
          updateId,
          Date.now() + retryDelayMs,
          "telegram_delivery_failed",
        );
      } catch {
        // An expired processing lease remains recoverable if Neon is unavailable.
      }
      throw new Error("Telegram background job could not finish.");
    }
  };

  const resumeTelegramJobs = async (maxJobs: number): Promise<void> => {
    const limit = Math.max(0, Math.min(10, Math.trunc(maxJobs)));
    if (!limit) return;
    const ids = await deps.store.pendingTelegramUpdateIds(Date.now(), limit);
    for (const updateId of ids) deps.background(processTelegramJob(updateId));
  };

  bot.catch(() => {
    // Telegraf's default handler logs the entire update (including its text).
    // Throw only a fixed error so Express returns a retryable 500 without data.
    throw new Error("Telegram webhook could not accept this update.");
  });

  return Object.assign(bot, { processTelegramJob, resumeTelegramJobs });
}

async function processWrite(
  job: TelegramInboundJob,
  updateId: number,
  deps: TelegramChannelDependencies,
  bot: Telegraf,
): Promise<void> {
  const body = writeBody(job.text);
  if (!body || Array.from(body).length > maxWriteCharacters) {
    await bot.telegram.sendMessage(
      job.chatId,
      localized(
        job,
        "Usage: /write followed by 1–4,000 characters. Nothing was saved.",
        "Cách dùng: /write kèm 1–4.000 ký tự. Chưa có nội dung nào được lưu.",
      ),
    );
    return;
  }
  const userId = await deps.store.telegramUserId(job.telegramId);
  if (!userId) {
    await bot.telegram.sendMessage(
      job.chatId,
      localized(
        job,
        "Connect your WalPen account first: send /start for a one-time link code.",
        "Hãy liên kết tài khoản WalPen trước: gửi /start để nhận mã dùng một lần.",
      ),
    );
    return;
  }

  let saved: Awaited<ReturnType<Repository["insertTelegramEntry"]>>;
  try {
    saved = await deps.store.insertTelegramEntry(
      updateId,
      writeEntry(userId, body),
    );
  } catch {
    try {
      await deps.store.releaseTelegramUpdate(
        updateId,
        Date.now() + retryDelayMs,
        "telegram_entry_persistence_failed",
      );
    } catch {
      // The processing lease remains recoverable if Neon is unavailable.
    }
    try {
      await bot.telegram.sendMessage(
        job.chatId,
        localized(
          job,
          "WalPen couldn’t save this note yet. It is not marked as saved; please try again shortly.",
          "WalPen chưa thể lưu ghi chú này. Ghi chú chưa được xác nhận đã lưu; vui lòng thử lại sau.",
        ),
      );
    } catch {
      // The queued update remains recoverable and will retry after its backoff.
    }
    return;
  }

  const acknowledgement = deps.memory.configured
    ? localized(
        job,
        "Your note is encrypted and queued for Walrus Memory.",
        "Ghi chú đã được mã hóa và xếp hàng để lưu lên Walrus Memory.",
      )
    : localized(
        job,
        "Your note is encrypted in WalPen, but Walrus Memory is not configured yet.",
        "Ghi chú đã được mã hóa trong WalPen, nhưng Walrus Memory chưa được cấu hình.",
      );
  await bot.telegram.sendMessage(job.chatId, acknowledgement);
  await synchronize(
    deps.store,
    deps.memory,
    saved.entry,
    deps.retryWindowMs,
  );
}

async function startMessage(
  job: TelegramInboundJob,
  store: Repository,
  config: TelegramChannelConfig,
  now: number,
): Promise<string> {
  if (await store.telegramUserId(job.telegramId))
    return job.language === "en"
      ? "You’re connected to WalPen. Send a note or ask about a memory."
      : "Tài khoản của bạn đã kết nối với WalPen. Hãy gửi ghi chú hoặc hỏi về ký ức.";
  const code = randomBytes(6).toString("hex").toUpperCase();
  const issued = await store.issueTelegramLinkCode({
    telegramId: job.telegramId,
    codeHash: hash(code),
    createdAt: now,
    expiresAt: now + codeLifetimeMs,
  });
  if (!issued)
    return job.language === "en"
      ? "Please wait 60 seconds before requesting another link code with /start."
      : "Vui lòng đợi 60 giây rồi gửi lại /start để tạo mã liên kết mới.";
  return job.language === "en"
    ? "Your one-time WalPen link code is " +
        code +
        ". Sign in at " +
        config.appOrigin +
        ", open Settings, and enter this code within 10 minutes."
    : "Mã liên kết WalPen dùng một lần của bạn là " +
        code +
        ". Đăng nhập tại " +
        config.appOrigin +
        ", mở Cài đặt và nhập mã trong 10 phút.";
}
