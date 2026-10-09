import { randomBytes, randomUUID } from "node:crypto";
import { Telegraf } from "telegraf";
import type { ChatModel, Source } from "../llm.ts";
import { budgetMemoryContext } from "../memory-context.ts";
import type { MemoryGateway, MemoryRecall } from "../memory.ts";
import { selectRecallContext } from "../recall.ts";
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
const telegramTextLimit = 4_096;

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
function isChat(text: string): boolean {
  return /^\/chat(?:@[\w_]+)?(?:\s|$)/i.test(text.trim());
}
function chatQuestion(text: string): string {
  const trimmed = text.trim();
  if (!isChat(trimmed)) return trimmed;
  return trimmed.replace(/^\/chat(?:@[\w_]+)?/i, "").trim();
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
        await processChat(job, deps, config, bot);
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

const transientNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNABORTED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function httpStatus(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== "object" || depth > 2) return undefined;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  const raw = value.status ?? value.statusCode;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d{3}$/.test(raw)) return Number(raw);
  if (value.cause && value.cause !== error)
    return httpStatus(value.cause, depth + 1);
  return undefined;
}
function networkCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 2) return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.code === "string") return value.code;
  if (value.cause && value.cause !== error)
    return networkCode(value.cause, depth + 1);
  return undefined;
}
function isTransientRecallError(error: unknown): boolean {
  const status = httpStatus(error);
  if (status === 502 || status === 503 || status === 504) return true;
  if (status !== undefined) return false;
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const code = networkCode(error);
  if (code && transientNetworkCodes.has(code)) return true;
  const message = (error as { message?: unknown }).message;
  return message === "fetch failed" || message === "recall_timeout";
}
function normalizedWords(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
function cachedSources(entries: Entry[], query: string): Source[] {
  const queryWords = normalizedWords(query);
  const ranked = entries
    .filter(
      (entry) =>
        entry.consent === true &&
        entry.status === "synced" &&
        !entry.retired &&
        typeof entry.blobId === "string" &&
        entry.blobId.length > 0,
    )
    .map((entry) => {
      const haystack = new Set(
        normalizedWords(`${entry.title}\n${entry.memory}`),
      );
      const matched = queryWords.filter((word) => haystack.has(word)).length;
      return {
        entry,
        score: queryWords.length ? matched / queryWords.length : 0,
      };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.createdAt.localeCompare(a.entry.createdAt),
    );
  return budgetMemoryContext(
    ranked.map(({ entry }) => ({
      id: entry.id,
      title: entry.title || "Một trang nhật ký",
      text: entry.memory,
      date: entry.occurredAt || entry.createdAt,
      blobId: entry.blobId!,
    })),
  ).sources;
}
function recallWithTimeout(
  recall: MemoryGateway["recall"],
  userId: string,
  query: string,
  timeoutMs: number,
): Promise<MemoryRecall> {
  // recall() accepts no AbortSignal, so this only discards a late result.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error("recall_timeout");
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([recall(userId, query), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function codePointLength(text: string): number {
  return Array.from(text).length;
}
function splitCodePoints(text: string, limit = telegramTextLimit): string[] {
  const points = Array.from(text);
  if (!points.length) return [];
  const parts: string[] = [];
  for (let index = 0; index < points.length; index += limit)
    parts.push(points.slice(index, index + limit).join(""));
  return parts;
}
function packLines(lines: string[], limit = telegramTextLimit): string[] {
  const messages: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (codePointLength(next) <= limit) {
      current = next;
      continue;
    }
    if (current) messages.push(current);
    if (codePointLength(line) <= limit) current = line;
    else {
      messages.push(...splitCodePoints(line, limit));
      current = "";
    }
  }
  if (current) messages.push(current);
  return messages;
}
async function sendTexts(bot: Telegraf, chatId: string, texts: string[]) {
  for (const text of texts) {
    if (text) await bot.telegram.sendMessage(chatId, text);
  }
}
function sourceCards(sources: Source[]): string[] {
  return sources.map(
    (source, index) => `Source ${index + 1} · Walrus blob: ${source.blobId}`,
  );
}
async function deliverAnswer(
  bot: Telegraf,
  chatId: string,
  prefix: string | undefined,
  answer: string,
  sources: Source[],
) {
  const body = prefix ? (answer ? `${prefix}\n\n${answer}` : prefix) : answer;
  await sendTexts(bot, chatId, splitCodePoints(body));
  await sendTexts(bot, chatId, packLines(sourceCards(sources)));
}
async function processChat(
  job: TelegramInboundJob,
  deps: TelegramChannelDependencies,
  config: TelegramChannelConfig,
  bot: Telegraf,
): Promise<void> {
  const question = chatQuestion(job.text);
  if (isChat(job.text) && !question) {
    await bot.telegram.sendMessage(
      job.chatId,
      localized(
        job,
        "Usage: /chat followed by a question.",
        "Cách dùng: /chat kèm một câu hỏi.",
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
  if (!deps.model.configured) {
    await bot.telegram.sendMessage(
      job.chatId,
      localized(
        job,
        "WalPen can’t answer yet because the AI model is not configured.",
        "WalPen chưa thể trả lời vì mô hình AI chưa được cấu hình.",
      ),
    );
    return;
  }
  let sources: Source[] = [];
  let prefix: string | undefined;
  try {
    const remote = await recallWithTimeout(
      (id, query) => deps.memory.recall(id, query),
      userId,
      question,
      config.recallTimeoutMs,
    );
    sources = selectRecallContext(
      remote,
      await deps.store.list(userId),
      deps.recallMaxDistance,
    ).sources;
  } catch (error) {
    if (!isTransientRecallError(error)) {
      await bot.telegram.sendMessage(
        job.chatId,
        localized(
          job,
          "WalPen couldn’t read your memories just now. Please try again shortly.",
          "WalPen chưa đọc được ký ức lúc này. Vui lòng thử lại sau.",
        ),
      );
      return;
    }
    sources = cachedSources(await deps.store.list(userId), question);
    prefix = sources.length
      ? localized(
          job,
          "Remote recall is unavailable. The encrypted cache supplied the cited Walrus blobs.",
          "Không truy xuất được ký ức từ xa. Bộ nhớ đệm đã mã hóa cung cấp các blob Walrus được trích dẫn.",
        )
      : localized(
          job,
          "Remote recall is unavailable. No encrypted-cache memory matched this question, so this answer does not claim remembered facts.",
          "Không truy xuất được ký ức từ xa. Không có ký ức trong bộ nhớ đệm khớp câu hỏi, nên câu trả lời này không khẳng định sự kiện đã nhớ.",
        );
  }
  let answer: string;
  try {
    answer = await deps.model.answer(question, [], sources, job.language);
  } catch {
    await bot.telegram.sendMessage(
      job.chatId,
      localized(
        job,
        "WalPen couldn’t complete this answer. Please try again shortly.",
        "WalPen chưa thể hoàn tất câu trả lời. Vui lòng thử lại sau.",
      ),
    );
    return;
  }
  await deliverAnswer(bot, job.chatId, prefix, answer, sources);
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
