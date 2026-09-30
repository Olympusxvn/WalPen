import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { hash, type Entry } from "./store.ts";
import type { Repository } from "./repository.ts";
import type { MemoryGateway } from "./memory.ts";
import type { ChatModel, Source } from "./llm.ts";
import { LocalModel } from "./llm.ts";
import { budgetMemoryContext } from "./memory-context.ts";
const derive = promisify(scrypt);
const accountSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9_.-]+$/),
  password: z.string().min(10).max(128),
  inviteCode: z.string().max(200).optional(),
});
const entrySchema = z
  .object({
    title: z.string().trim().max(120).default(""),
    body: z.string().trim().min(1).max(12000),
    memory: z.string().trim().max(2000).default(""),
    mood: z.string().max(16).default("🌿"),
    consent: z.boolean(),
    occurredAt: z.string().datetime(),
    supersedes: z.string().uuid().nullable().optional(),
  })
  .refine((e) => !e.consent || e.memory.length > 0, {
    message: "Hãy chọn nội dung bạn muốn WalPen nhớ.",
  });
const cookieName = "walpen_session";
export function createApp(
  store: Repository,
  memory: MemoryGateway,
  model: ChatModel,
  options: {
    origin?: string;
    production?: boolean;
    rateLimits?: boolean;
    inviteCode?: string;
    background?: (work: Promise<unknown>) => void;
    trustProxy?: number | string;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (options.production)
    app.set("trust proxy", options.trustProxy ?? "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          upgradeInsecureRequests: options.production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!req.is("application/json"))
        return res.status(415).json({ error: "JSON required." });
      const origin = req.get("origin");
      const origins = options.production
        ? [options.origin]
        : [options.origin, "http://localhost:5173", "http://127.0.0.1:5173"];
      if (origin && !origins.includes(origin))
        return res.status(403).json({ error: "Origin not allowed." });
      if (req.get("sec-fetch-site") === "cross-site")
        return res.status(403).json({ error: "Cross-site request denied." });
    }
    next();
  });
  if (options.rateLimits !== false)
    app.use(
      "/api",
      rateLimit({
        windowMs: 60000,
        limit: 120,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    skip: () => options.rateLimits === false,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  async function session(req: express.Request) {
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!token) return undefined;
    return store.session(hash(token), Date.now());
  }
  async function setSession(res: express.Response, id: string) {
    const token = randomBytes(32).toString("hex");
    await store.addSession(hash(token), id, Date.now() + 30 * 86400000);
    res.cookie(cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: !!options.production,
      maxAge: 30 * 86400000,
      path: "/",
    });
  }
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/session", async (req, res) =>
    res.json({
      user: (await session(req)) || null,
      services: {
        walrus: memory.configured,
        llm: model.configured,
        model: model.name,
        byok: true,
      },
      inviteRequired: !!options.inviteCode,
    }),
  );
  app.post("/api/register", authLimiter, async (req, res) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error:
          "Tên tài khoản: 3–40 ký tự a-z, số, dấu . _ -. Mật khẩu ít nhất 10 ký tự.",
      });
    const { username, password, inviteCode } = parsed.data;
    if (options.inviteCode && inviteCode !== options.inviteCode)
      return res.status(403).json({ error: "Mã mời chưa đúng." });
    const salt = randomBytes(16).toString("hex");
    const key = (await derive(password, salt, 64)) as Buffer;
    const id = randomUUID();
    try {
      await store.addUser({
        id,
        username,
        password: `${salt}:${key.toString("hex")}`,
        createdAt: new Date().toISOString(),
      });
    } catch (error: any) {
      if (
        error.code !== "23505" &&
        !String(error.message).includes("UNIQUE constraint failed")
      )
        throw error;
      return res.status(409).json({ error: "Tên tài khoản đã được sử dụng." });
    }
    await setSession(res, id);
    res.status(201).json({ user: { id, username } });
  });
  app.post("/api/login", authLimiter, async (req, res) => {
    const parsed = accountSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Kiểm tra tên tài khoản và mật khẩu." });
    const u = await store.userByName(parsed.data.username);
    const [salt, digest] = (
      u?.password || "00000000000000000000000000000000:" + "00".repeat(64)
    ).split(":");
    const key = (await derive(parsed.data.password, salt, 64)) as Buffer;
    if (!u || !timingSafeEqual(key, Buffer.from(digest, "hex")))
      return res
        .status(401)
        .json({ error: "Tên tài khoản hoặc mật khẩu chưa đúng." });
    await setSession(res, u.id);
    res.json({ user: { id: u.id, username: u.username } });
  });
  app.use("/api", async (req, res, next) => {
    const user = await session(req);
    if (!user)
      return res
        .status(401)
        .json({ error: "Hãy đăng nhập để mở trang nhật ký của bạn." });
    res.locals.user = user;
    next();
  });
  app.post("/api/logout", async (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (token) await store.deleteSession(hash(token));
    res.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: !!options.production,
    });
    res.json({ ok: true });
  });
  const running = new Set<string>();
  function background(work: Promise<unknown>) {
    const guarded = work.catch(() =>
      console.error(
        "Background synchronization could not finish; durable state retained.",
      ),
    );
    if (options.background) options.background(guarded);
  }
  async function sync(e: Entry) {
    if (running.has(e.id) || !memory.configured) return;
    running.add(e.id);
    let jobId = e.jobId;
    try {
      // Persist an ambiguous state BEFORE a network write. A crash can never blindly resubmit it.
      if (!jobId) {
        if (!(await store.claim(e.id))) return;
        jobId = await memory.remember(e);
        await store.sync(e.id, "pending", jobId, null, null);
      }
      const blob = await memory.wait(e.userId, jobId);
      await store.sync(e.id, "synced", jobId, blob, null);
    } catch (err) {
      const failed =
        err instanceof Error && err.message.startsWith("remember job failed:");
      await store.sync(
        e.id,
        failed ? "failed" : jobId ? "pending" : "uncertain",
        jobId,
        null,
        failed
          ? "Walrus báo job thất bại. Bản cục bộ còn nguyên; cần kiểm tra job trước khi lưu lại."
          : jobId
            ? "Walrus chưa xác nhận hoàn tất. Bạn có thể kiểm tra lại job hiện tại."
            : "Chưa xác định yêu cầu đã được tiếp nhận. Không tự động gửi lại để tránh bản sao.",
      );
    } finally {
      running.delete(e.id);
    }
  }
  function safe(e: Entry) {
    const { userId, ...rest } = e;
    return rest;
  }
  app.get("/api/entries", async (_req, res) => {
    if (options.background) background(resume(res.locals.user.id));
    res.json({ entries: (await store.list(res.locals.user.id)).map(safe) });
  });
  app.post("/api/entries", async (req, res) => {
    const parsed = entrySchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.issues[0].message });
    const userId = res.locals.user.id;
    const old = parsed.data.supersedes
      ? await store.get(parsed.data.supersedes, userId)
      : undefined;
    if (parsed.data.supersedes && (!old || old.retired))
      return res
        .status(404)
        .json({ error: "Không tìm thấy phiên bản hiện tại." });
    const id = randomUUID();
    const e: Entry = {
      ...parsed.data,
      id,
      userId,
      rootId: old?.rootId || id,
      revision: (old?.revision || 0) + 1,
      supersedes: old?.id || null,
      createdAt: new Date().toISOString(),
      status: "queued",
      jobId: null,
      blobId: null,
      error: null,
      retired: false,
    };
    await store.insert(e);
    background(sync(e));
    res.status(202).json({ entry: safe(e) });
  });
  app.post("/api/entries/:id/check", async (req, res) => {
    const e = await store.get(String(req.params.id), res.locals.user.id);
    if (!e) return res.status(404).json({ error: "Không tìm thấy trang này." });
    if (e.status === "uncertain") {
      if (running.has(e.id)) return res.json({ entry: safe(e) });
      try {
        const found = (await memory.recall(e.userId, e.id)).find((r) => {
          try {
            const v = JSON.parse(r.text);
            return (
              v.schema === "walpen/v1" &&
              v.id === e.id &&
              v.body === e.body &&
              v.memory === e.memory
            );
          } catch {
            return false;
          }
        });
        if (found) {
          await store.sync(e.id, "synced", e.jobId, found.blob_id, null);
          return res.json({ entry: safe((await store.get(e.id, e.userId))!) });
        }
      } catch {}
      return res.status(409).json({
        error:
          "Chưa tìm thấy bản ghi khi đối soát. Dữ liệu cục bộ vẫn được giữ; ứng dụng chưa gửi lại để tránh tạo bản sao.",
      });
    }
    if (e.status !== "synced") background(sync(e));
    res.json({ entry: safe(e) });
  });
  app.post("/api/entries/:id/forget", async (req, res) => {
    const e = await store.get(String(req.params.id), res.locals.user.id);
    if (!e || e.retired)
      return res.status(404).json({ error: "Không tìm thấy trang này." });
    const n: Entry = {
      ...e,
      id: randomUUID(),
      revision: e.revision + 1,
      supersedes: e.id,
      consent: false,
      memory: "",
      createdAt: new Date().toISOString(),
      status: "queued",
      jobId: null,
      blobId: null,
      error: null,
    };
    await store.insert(n);
    background(sync(n));
    res.json({ entry: safe(n) });
  });
  const chatLimiter = rateLimit({
    windowMs: 60000,
    limit: 8,
    skip: () => options.rateLimits === false,
    keyGenerator: (_req, res) => res.locals.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.post("/api/chat", chatLimiter, async (req, res) => {
    const parsed = z
      .object({
        message: z.string().trim().min(1).max(2000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(6000),
            }),
          )
          .max(8)
          .default([]),
        useMemory: z.boolean().default(true),
        language: z.enum(["en", "vi"]).default("vi"),
        llm: z
          .object({
            provider: z.enum(["gemini", "openai"]),
            apiKey: z.string().trim().min(10).max(512),
            model: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .regex(/^[a-zA-Z0-9_.:-]+$/),
          })
          .optional(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Tin nhắn chưa hợp lệ." });
    const requestModel = parsed.data.llm
      ? new LocalModel(parsed.data.llm)
      : model;
    if (!requestModel.configured)
      return res.status(503).json({
        error:
          "Chưa cấu hình AI. Thêm khóa Gemini hoặc OpenAI trong Cài đặt để trò chuyện.",
      });
    const { message, history, useMemory } = parsed.data;
    let sources: Source[] = [];
    if (useMemory && memory.configured) {
      try {
        const remote = await memory.recall(res.locals.user.id, message);
        const active = (await store.list(res.locals.user.id)).filter(
          (e) => e.consent && e.status === "synced",
        );
        const seen = new Set<string>();
        for (const r of remote) {
          const e = active.find((e) => e.blobId === r.blob_id);
          if (!e || seen.has(e.id)) continue;
          let record: any;
          try {
            record = JSON.parse(r.text);
          } catch {
            continue;
          }
          if (
            record.schema !== "walpen/v1" ||
            record.id !== e.id ||
            record.consent !== true ||
            typeof record.memory !== "string" ||
            record.memory !== e.memory
          )
            continue;
          sources.push({
            id: e.id,
            title: e.title || "Một trang nhật ký",
            text: record.memory,
            date: e.occurredAt,
            blobId: r.blob_id,
          });
          seen.add(e.id);
        }
      } catch {
        return res.status(503).json({
          error:
            "Chưa đọc được ký ức từ Walrus. Thử lại hoặc tắt “Dùng ký ức” để trò chuyện không có bộ nhớ.",
        });
      }
    }
    const context = budgetMemoryContext(sources);
    sources = context.sources;
    // Do not trust old client-provided history to reintroduce withdrawn memories.
    const safeHistory = history.filter((m) => m.role === "user");
    try {
      const answer = await requestModel.answer(
        message,
        safeHistory,
        sources,
        parsed.data.language,
      );
      // A withdrawal/edit may finish while the LLM is generating. The prompt
      // cannot be recalled, but the obsolete answer must not be published.
      if (
        (
          await Promise.all(
            sources.map(async (source) => {
              const current = await store.get(source.id, res.locals.user.id);
              return (
                !current ||
                current.retired ||
                !current.consent ||
                current.status !== "synced" ||
                current.blobId !== source.blobId ||
                current.memory !== source.text
              );
            }),
          )
        ).some(Boolean)
      ) {
        return res.status(409).json({
          error:
            "Ký ức đã thay đổi khi đang trả lời. Hãy gửi lại câu hỏi để dùng thông tin hiện tại.",
        });
      }
      res.json({
        answer,
        sources,
        model: requestModel.name,
        memoryUsed: sources.length > 0,
        memoryBudget: context.meta,
      });
    } catch (err) {
      res.status(503).json({
        error:
          err instanceof Error && err.message.startsWith("LLM")
            ? err.message
            : "Chưa kết nối được dịch vụ AI. Kiểm tra khóa, model và dịch vụ trong Cài đặt.",
      });
    }
  });
  app.get("/api/export", async (req, res) => {
    const entries = await store.list(res.locals.user.id);
    const format = req.query.format === "md" ? "md" : "json";
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="walpen-journal.${format}"`,
    );
    if (format === "md")
      return res
        .type("text/markdown")
        .send(
          entries
            .map(
              (e) =>
                `# ${e.title || "Một trang nhật ký"}\n\n${e.occurredAt} · ${e.mood}\n\n${e.body}\n\n---`,
            )
            .join("\n\n"),
        );
    res.json({
      schema: "walpen-export/v1",
      exportedAt: new Date().toISOString(),
      entries: entries.map(safe),
    });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Không tìm thấy API." }),
  );
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(err?.type === "entity.too.large" ? 413 : 500)
        .json({ error: "Yêu cầu không thực hiện được. Vui lòng thử lại." });
    },
  );
  async function resume(userId?: string) {
    await Promise.all(
      (await store.pending(userId)).map((entry) => sync(entry)),
    );
  }
  return { app, resume };
}
