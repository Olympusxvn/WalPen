# WalPen Telegram Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Telegram webhook channel that links to existing WalPen accounts, saves encrypted journal entries to Walrus Memory, chats with bounded approved memories, and exposes bilingual Telegram actions in the web UI.

**Architecture:** Build on the existing Express app and injected `Repository`, `MemoryGateway`, `ChatModel`, and Vercel background callback. `server/channels/telegram.ts` mounts Telegraf's own webhook middleware before cookie authentication; the webhook validates and durably queues an encrypted update, schedules its worker, and returns without waiting on MemWal or the LLM. Background jobs send results with `bot.telegram.sendMessage()`. Neon/SQLite repository methods provide atomic account linking, job leases/deduplication, and encrypted Telegram Entry insertion. The React UI stays in `src/App.tsx` and uses authenticated link endpoints.

**Tech Stack:** TypeScript, Express 5, Telegraf webhook middleware, PostgreSQL/Neon, SQLite, AES-256-GCM, existing MemWal adapter, React, Vite, Node test runner, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-telegram-channel-design.md`

## Global Constraints

- Mount the webhook using Telegraf's Express middleware directly: `app.use(bot.webhookCallback("/api/telegram-webhook", { secretToken }))`.
- Return Telegraf's HTTP 200 only after the update is authenticated, encrypted, and durably enqueued, then register the worker with the existing injected background callback. Do not call `res.sendStatus()` separately or await recall/model work in webhook middleware; on queue-write failure, let the webhook return an error so Telegram can retry.
- `vercel.json` already configures `api/index.ts` with `maxDuration: 300`; `/api/telegram-webhook` rewrites into that catch-all function. Preserve the 300-second limit (the plan's effective Vercel ceiling still applies). `waitUntil()` keeps work alive only up to the same function duration, so job state and lease expiry remain durable in Neon for recovery.
- Link codes are cryptographically random, stored only as a digest, bound to a Telegram ID, expire after ten minutes, and are consumed atomically.
- Telegram normal text and `/chat <question>` use memory-backed chat; `/write <text>` saves a journal entry and approves that submitted text for Walrus Memory.
- Reuse the existing AES-256-GCM Entry encoding path used by `PostgresStore.insert()` inside the atomic Telegram Entry transaction; never expose `DATA_ENCRYPTION_KEY` through an HTTP endpoint.
- Chat recall must use `selectRecallContext()` and `budgetMemoryContext()`, with at most five sources and 768 estimated tokens.
- Vercel Telegram chat uses server-configured Gemini/OpenAI; local Telegram chat can use Ollama. Do not persist or reuse browser session-only BYOK.
- Render a localized Telegram action beside VI/EN and a second action in the home chat invitation; the actual bot destination comes from `VITE_TELEGRAM_BOT_URL`.
- Document `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, webhook setup, and bot destination configuration; never add real tokens to tracked files.

## Review Focus

1. **Expired, replayed, mistyped, or cross-account link codes:** treat them as unusable, never attach another Telegram identity, and verify with repository and authenticated API tests.
2. **Forged or malformed webhook updates:** reject an incorrect secret token and invalid Telegram payloads without queueing work; verify with an Express/Supertest route test.
3. **Duplicate or concurrent Telegram update delivery:** never create duplicate jobs or journal Entries; return 200 for an already queued/completed update and run a worker only when it owns the lease. Verify across two repository instances.
4. **Oversized/Unicode Telegram text and response limits:** validate input before persistence/model calls and keep outgoing messages within Telegram's 4096-character limit; test multibyte content and boundary sizes.
5. **Unavailable MemWal/model and interrupted background work:** preserve durable encrypted jobs and queued Entries, use only eligible synced local cache on transient recall errors, return an honest status, and never claim a Walrus blob before a receipt exists; test with fake services and Vercel `waitUntil` injection.

---

### Task 1: Add durable Telegram identity and update storage

**Files:**
- Modify: `server/repository.ts`
- Modify: `server/store.ts`
- Modify: `server/postgres-store.ts`
- Create: `tests/telegram-persistence.test.ts`
- Modify: `tests/postgres.integration.ts`

**Interfaces:**
- Produces `TelegramLinkStatus = { telegramId: string; linkedAt: string }` and `TelegramLinkResult = "linked" | "invalid" | "expired" | "conflict"` in `server/repository.ts`.
- Produces `TelegramInboundJob = { updateId: number; telegramId: string; chatId: string; text: string; language: "en" | "vi" }`; validate and normalize sender/chat/text/language before storing. Keep sender ID for account linking and chat ID for outbound messages. Accept text-message updates only; acknowledge and ignore unsupported update kinds.
- Produces repository methods:
  - `issueTelegramLinkCode(input: { telegramId: string; codeHash: string; createdAt: number; expiresAt: number }): Result<boolean>`; returns false when the same Telegram ID requested another code within 60 seconds.
  - `telegramUserId(telegramId: string): Result<string | undefined>`.
  - `telegramLinkForUser(userId: string): Result<TelegramLinkStatus | undefined>`.
  - `consumeTelegramLinkCode(codeHash: string, userId: string, now: number): Result<TelegramLinkResult>`.
  - `enqueueTelegramUpdate(input: TelegramInboundJob, now: number): Result<{ created: boolean; state: "queued" | "processing" | "done" | "failed" | "uncertain" }>`; encrypts the normalized inbound payload before insert and is unique by Telegram `update_id`; an expired processing lease becomes eligible for a new worker.
  - `claimTelegramUpdate(updateId: number, now: number, leaseUntil: number): Result<TelegramInboundJob | undefined>`; atomically claims a queued job or reclaims an expired lease, returning the decrypted payload only to the worker. Use a 360-second lease, longer than the configured 300-second Vercel function budget, to prevent concurrent recovery while the original worker is alive.
  - `finishTelegramUpdate(updateId: number, status: "done" | "failed" | "uncertain", now: number, safeErrorCode?: string): Result<void>` and `releaseTelegramUpdate(updateId: number, nextAttemptAt: number, safeErrorCode: string): Result<void>`.
  - `insertTelegramEntry(updateId: number, entry: Entry): Result<{ entry: Entry; created: boolean }>`; atomically returns the existing Entry if that Telegram update already inserted one.
- Both SQLite and PostgreSQL implement the same outcomes. Use `telegram_links(telegram_id PRIMARY KEY, user_id UNIQUE, linked_at)`, `telegram_link_codes(code_hash PRIMARY KEY, telegram_id, created_at, expires_at)`, and `telegram_updates(update_id PRIMARY KEY, payload_ciphertext, state, attempts, available_at, lease_until, completed_at, entry_id UNIQUE NULLABLE, safe_error_code)`; add equivalent Postgres constraints and indexes. Store link-code digests only; encrypt update payloads and Entry data with AES-256-GCM. `insertTelegramEntry` must insert the encrypted Entry and associate its ID with the update in one transaction. Never persist raw chat text or raw exceptions in queue metadata.

- [ ] **Step 1: Write failing SQLite repository tests** in `tests/telegram-persistence.test.ts` named `link code expires and can only be consumed once`, `telegram identity and WalPen user are one-to-one`, `telegram update enqueue is encrypted and idempotent`, `telegram job claims reject active and completed replays`, and `telegram entry insertion is idempotent and encrypted`. Assert the 60-second issue cooldown, ten-minute expiry using supplied timestamps, cross-user conflict, lease reclamation, duplicate update/Entry result, and that raw SQLite payload contains no plaintext message, body, or memory.
- [ ] **Step 2: Run `npx tsx --test tests/telegram-persistence.test.ts`**. Expected: FAIL because the repository methods/tables do not exist.
- [ ] **Step 3: Add the repository types and implement matching SQLite tables/transactions** in `server/repository.ts` and `server/store.ts`. Encrypt normalized Telegram job payloads before enqueue. Keep enqueue, claim, finish/release, and update-to-entry association atomic; insert the Entry and associate its update in one SQLite transaction.
- [ ] **Step 4: Implement the same schema, expiry cleanup, one-to-one constraints, transactions, encrypted queue payloads, idempotent enqueue/insert, and lease recovery** in `server/postgres-store.ts`.
- [ ] **Step 5: Rerun `npx tsx --test tests/telegram-persistence.test.ts`**. Expected: PASS for every named scenario.
- [ ] **Step 6: Add an isolated-schema Neon integration case** in `tests/postgres.integration.ts` that runs the same link-code, encrypted enqueue, claim/reclaim, and duplicate-entry scenarios against two `PostgresStore` instances; run `npm run test:cloud` when `WALPEN_TEST_DATABASE_URL` is configured. Expected: PASS without relying on process-local locks.
- [ ] **Step 7: Commit** as `feat: persist Telegram identity and update state`.

### Task 2: Add authenticated Telegram account-link endpoints

**Files:**
- Modify: `server/app.ts`
- Modify: `tests/app.test.ts`
- Test: `tests/telegram-persistence.test.ts`

**Interfaces:**
- Produces authenticated `GET /api/telegram/status` returning `{ linked: false }` or `{ linked: true, telegramId: string, linkedAt: string }` for the current `res.locals.user.id` only.
- Produces authenticated `POST /api/telegram/link` accepting `{ code: string }` and returning `{ linked: true }` on success. Invalid, expired, and conflicting codes return a generic 400 response.
- Code normalization is trim + uppercase; digest with existing `hash()` from `server/store.ts`. Use an endpoint-specific `express-rate-limit` instance, sharing existing proxy and rate-limit conventions.

- [ ] **Step 1: Write failing API tests** named `telegram status is scoped to the signed-in WalPen user`, `telegram linking consumes a valid code and rejects reuse`, `expired and cross-account codes never link`, and `telegram linking is rate limited`. Assert unauthenticated requests return 401; verify two accounts cannot inspect or claim the other's Telegram ID.
- [ ] **Step 2: Run `npx tsx --test tests/app.test.ts`**. Expected: FAIL because the protected Telegram routes are not mounted.
- [ ] **Step 3: Add the authenticated status and link routes** in `server/app.ts`, using only repository methods and the current session identity. Add an endpoint-specific limiter; never accept a Telegram ID from the browser request.
- [ ] **Step 4: Run `npx tsx --test tests/app.test.ts`**. Expected: PASS for the new link-route tests and existing app tests.
- [ ] **Step 5: Commit** as `feat: link Telegram to WalPen accounts`.

### Task 3: Mount the fast-ack Telegraf webhook and durable worker

**Files:**
- Create: `server/channels/telegram.ts`
- Modify: `server/app.ts`
- Modify: `api/index.ts`
- Modify: `server/index.ts`
- Verify: `vercel.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `SETUP.md`
- Create: `tests/telegram-webhook.test.ts`

**Interfaces:**
- Add `TelegramChannelConfig = { botToken: string; webhookSecret: string; appOrigin: string; recallTimeoutMs: number }`, `TelegramInboundJob`, `createTelegramBot(deps, config): Telegraf`, `processTelegramJob(updateId)`, and bounded `resumeTelegramJobs(maxJobs)` in `server/channels/telegram.ts`.
- `deps` contains `store: Repository`, `memory: MemoryGateway`, `model: ChatModel`, `background(work: Promise<unknown>): void`, `recallMaxDistance: number | null`, and the existing retry-window value used by `synchronize()`.
- Add optional `telegram?: TelegramChannelConfig` to `createApp()` options. When configured, register `app.use(bot.webhookCallback("/api/telegram-webhook", { secretToken: config.webhookSecret }))` after JSON parsing and before the session guard. The Telegraf handler only normalizes and durably encrypts/enqueues the update, then registers `background(processTelegramJob(updateId))` without awaiting it. Telegraf owns the single HTTP response and returns 200 after enqueue; do not call `res.send()` or wait for MemWal/LLM work in the request path.
- If enqueue fails, let Telegraf return an error so Telegram can retry. If `update_id` already exists, no-op duplicates with a normal 200 response; schedule eligible queued/stale jobs only after atomically acquiring their lease.
- When token/secret are absent, keep the rest of the API available and return 503 for the webhook path.
- Verify `vercel.json` keeps `api/index.ts` at `maxDuration: 300`; all API paths including the webhook currently rewrite to this one function. Pass the existing Vercel `waitUntil` callback so its lifetime extends up to this limit. Do not use `process.nextTick()` as the Vercel background runner.

- [ ] **Step 1: Add Telegraf as a runtime dependency** with `npm install telegraf` and commit the lockfile with this task.
- [ ] **Step 2: Write failing webhook tests** named `webhook rejects an incorrect Telegram secret`, `webhook returns 200 after encrypted enqueue without awaiting a slow worker`, `webhook owns a single response`, `webhook enqueue failure returns a retryable error`, and `duplicate update is acknowledged without duplicate job`. Mock slow recall/model work and Telegraf API; assert 200 arrives before worker completion, only one encrypted job exists, and the request sends no chat reply.
- [ ] **Step 3: Run `npx tsx --test tests/telegram-webhook.test.ts`**. Expected: FAIL because the channel and webhook middleware are not mounted.
- [ ] **Step 4: Implement the Telegraf ingress middleware and encrypted durable queue**. Normalize only the fields needed downstream (`update_id`, sender Telegram ID, chat ID, text, and language code), enqueue them before returning, and register a leased worker through the injected background callback. Do not perform code generation, `recall()`, or AI calls in the webhook request path.
- [ ] **Step 5: Implement worker handling for `/start`**. Generate a cryptographically random 12-character code with `randomBytes`, store only `hash(code)`, bind it to the sender Telegram ID, expire after ten minutes, enforce the repository's 60-second issue cooldown, and tell the user to sign in to WalPen Settings and paste the code using `bot.telegram.sendMessage(chatId, text)`. If already linked, greet without issuing another code. Complete or safely release the job lease according to its persisted outcome.
- [ ] **Step 6: Wire configuration in `server/app.ts`, `api/index.ts`, and `server/index.ts`**. Pass Vercel `waitUntil` as the background callback and keep the webhook before cookie authentication. Schedule a bounded `resumeTelegramJobs()` scan with `waitUntil()` on each Vercel API invocation; call the same recovery helper from the local server's existing periodic recovery loop. Do not call `bot.launch()` in the serverless runtime. Confirm `vercel.json` still sets `api/index.ts` `maxDuration` to 300; changing it to 30 would reduce the existing budget.
- [ ] **Step 7: Document `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `APP_ORIGIN`, `TELEGRAM_RECALL_TIMEOUT_MS`, and the one-time Telegram `setWebhook` URL `https://<host>/api/telegram-webhook`** in `.env.example` and `SETUP.md`. Describe local tunnel use for testing without storing tokens in docs.
- [ ] **Step 8: Run `npx tsx --test tests/telegram-webhook.test.ts` and `npm run build`**. Expected: PASS and TypeScript/Vite build succeeds.
- [ ] **Step 9: Commit** as `feat: add Telegraf webhook and account linking start flow`.

### Task 4: Implement encrypted `/write` with durable deduplication

**Files:**
- Modify: `server/channels/telegram.ts`
- Modify: `tests/telegram-webhook.test.ts`
- Modify: `tests/app.test.ts`

**Interfaces:**
- The `/write` handler accepts 1–4000 Unicode characters after trimming; it constructs a normal `Entry` with a generated UUID, `rootId` equal to the new ID, `revision: 1`, `title: "Telegram journal"`, `body` and `memory` equal to the submitted text, `consent: true`, `status: "queued"`, `jobId/blobId/error: null`, and `retired: false`.
- The worker persists with `insertTelegramEntry(updateId, entry)` before sending a short queued confirmation through `bot.telegram.sendMessage(chatId, text)`. Run the existing `synchronize(store, memory, entry, retryWindowMs)` pipeline inside the worker promise already registered with `waitUntil()`; do not wait for Walrus completion before sending the confirmation or nest another background registration. A duplicate webhook update must reuse the stored Entry and must not create another Walrus write.

- [ ] **Step 1: Write failing tests** named `write stores an encrypted approved Entry and returns queued status`, `write update replay does not add another Entry or MemWal submission`, `write rejects empty and oversized text`, and `write reports a persistence failure without claiming the entry was saved`. Assert a fake background callback receives synchronization work after durable persistence, the webhook returns 200 before slow MemWal work finishes, the Telegram queued notice is sent by the worker, and raw DB payload excludes message plaintext.
- [ ] **Step 2: Run `npx tsx --test tests/telegram-webhook.test.ts`**. Expected: FAIL because `/write` is not implemented.
- [ ] **Step 3: Add `/write` processing** to the leased job worker in `server/channels/telegram.ts`. Require a linked sender ID, persist the Entry and update association transactionally, send an honest queued notice with `bot.telegram.sendMessage()`, then await the existing `synchronize()` pipeline within the worker promise already registered with `waitUntil()`; do not nest another background registration.
- [ ] **Step 4: Ensure retried or reclaimed update IDs return the existing durable Entry** and cannot create a second entry. A recovered `/write` must pass the existing durable `synchronize()` write-intent/idempotency path, so a lost Telegram response cannot create a second Walrus write. Expected validation errors should reply and finish the update; unexpected failures release the claim so Telegram can retry.
- [ ] **Step 5: Run `npx tsx --test tests/telegram-webhook.test.ts` and `npm test`**. Expected: PASS; existing journal/consent/recovery behavior remains unchanged.
- [ ] **Step 6: Commit** as `feat: save Telegram journal entries through Walrus sync`.

### Task 5: Implement bounded memory-backed Telegram chat and local fallback

**Files:**
- Modify: `server/channels/telegram.ts`
- Modify: `tests/telegram-webhook.test.ts`
- Modify: `tests/app.test.ts`

**Interfaces:**
- Handle regular text and `/chat <question>` in the leased job worker. Resolve `telegramUserId(job.telegramId)`; unlinked users receive the `/start` instructions through `bot.telegram.sendMessage()`.
- Use `memory.recall(userId, question)` with a bounded wait, then `selectRecallContext(remote, await store.list(userId), recallMaxDistance)`, then `budgetMemoryContext()` (through the selector's existing bounded result). Call `model.answer(question, [], sources, detectedLanguage)`; do not pass Telegram chat history or browser BYOK.
- On transient recall timeout/network errors and HTTP 502/503/504, rank local Entries by normalized query-word overlap. Filter strictly to `consent === true`, `status === "synced"`, `!retired`, and a confirmed `blobId`; pass the ranked results through the same five-source/768-token budget. Prefix the answer with a localized notice that remote recall is unavailable and the encrypted Neon cache supplied the cited Walrus blobs. If no cache matches, use no sources and say remote recall is unavailable without claiming remembered facts.
- After generation, use `bot.telegram.sendMessage(chatId, answer)` (not `ctx.reply()` in the webhook request), followed by plain-text source cards `Source N · Walrus blob: <full blob_id>`. Keep every outgoing text at or below 4096 JavaScript code points/Telegram characters; split long output without losing its source cards. Send localized, friendly fallback/model-error text only; never send raw exceptions, stack traces, query text in diagnostics, or credentials to chat/logs.

- [ ] **Step 1: Write failing tests** named `telegram webhook returns 200 before delayed recall and model complete`, `telegram chat uses only consented relevant memories within five sources and 768 tokens`, `chat includes full Walrus blob IDs for selected sources`, `normal text and chat command use the configured model`, `unlinked users are directed to start`, `502 and 504 recall failures use only eligible cached memories`, `recall timeout with no cache returns a friendly answer without sources`, and `chat reports unavailable model without exposing raw errors`. Configure slow fake services and more than five recall/cache results; assert the model receives only selected authorized sources and diagnostics do not leak.
- [ ] **Step 2: Run `npx tsx --test tests/telegram-webhook.test.ts`**. Expected: FAIL because chat command handling is absent.
- [ ] **Step 3: Implement background chat** using existing authorization, relevance, and budgeting code. Set `TELEGRAM_RECALL_TIMEOUT_MS` to a default of 8000ms, enforce a configurable bounded wait (and use SDK request cancellation if supported); for transient network, timeout, or 502/503/504 MemWal errors use the local cache selector; otherwise send a friendly localized message. Use `model.configured` before generation and the existing model request timeout; call `bot.telegram.sendMessage()` only after generation completes.
- [ ] **Step 4: Add Telegram-safe formatting/splitting** and tests for 4096-character boundaries, fallback notice retention, source card retention, Unicode emoji, and long blob IDs. Use plain text to avoid markup-injection or escaping ambiguity.
- [ ] **Step 5: Run `npx tsx --test tests/telegram-webhook.test.ts` and `npm test`**. Expected: PASS; webhook acknowledgement does not await slow services, fallback sources remain bounded, and only eligible stored blobs are cited.
- [ ] **Step 6: Commit** as `feat: add bounded memory chat to Telegram`.

### Task 6: Add bilingual Telegram actions and Settings linking form

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/style.css`
- Modify: `src/translations.ts`
- Modify: `.env.example`
- Create: `tests/ui/telegram.mjs`
- Modify: `tests/i18n.test.ts`

**Interfaces:**
- Read destination from `import.meta.env.VITE_TELEGRAM_BOT_URL || "https://t.me"`; set links to open safely in a new tab.
- Add a `Chat via Telegram` / `Trò chuyện qua Telegram` action next to VI/EN and in the existing home “A friend who listens” section.
- In authenticated Settings, load `/api/telegram/status`; show status and an input for a single code. Submit to `/api/telegram/link` through the existing `api()` helper; display localized success/error state and do not persist the code in storage.

- [ ] **Step 1: Write a failing UI test** in `tests/ui/telegram.mjs` with a mocked `/api/session`, `/api/entries`, `/api/telegram/status`, and `/api/telegram/link`; assert EN/VI link labels, configured link destination, Settings input, success feedback, and that an anonymous guest does not see the authenticated code form.
- [ ] **Step 2: Run `node tests/ui/telegram.mjs`**. Expected: FAIL because Telegram actions and Settings controls are absent.
- [ ] **Step 3: Add both actions and localized strings** in `src/App.tsx` and `src/translations.ts`; style them with existing button/link tokens in `src/style.css` and a subtle hover/focus-visible treatment.
- [ ] **Step 4: Add signed-in Settings status and code form** using the authenticated API; validate trim/maximum length client-side but rely on the server for security. Show a short notice that Telegram handles sent messages and the configured AI provider handles chat.
- [ ] **Step 5: Run `node tests/ui/telegram.mjs`, `npx tsx --test tests/i18n.test.ts`, and `npm run build`**. Expected: PASS in EN/VI with no missing translation keys or TypeScript errors.
- [ ] **Step 6: Commit** as `feat: add Telegram actions and account linking UI`.

### Task 7: Full integration and regression verification

**Files:**
- Modify: `tests/telegram-webhook.test.ts` if integration gaps surface.
- Modify: `tests/telegram-persistence.test.ts` if integration gaps surface.
- Modify: `docs/superpowers/specs/2026-10-09-telegram-channel-design.md` only if a code-level adjustment changes the approved design.
- Verify: `vercel.json`

**Interfaces:** Consumes the implementations and tests from Tasks 1–6; produces a verified local build and test report. Do not configure a real Telegram bot, expose credentials, write to Mainnet, or deploy as part of this task.

- [ ] **Step 1: Run `npm test`**. Expected: all test files pass, including existing app, wallet, recall, recovery, and local setup tests.
- [ ] **Step 2: Run `npm run build`**. Expected: TypeScript and Vite production build pass.
- [ ] **Step 3: Run `node tests/ui/telegram.mjs`**. Expected: both language modes, configured destination, Settings status/link flow, and anonymous behavior pass with external requests blocked.
- [ ] **Step 4: If `WALPEN_TEST_DATABASE_URL` exists, run `npm run test:cloud`** against its isolated test schema. Expected: repository concurrency/deduplication tests pass across two PostgreSQL stores; no real production Neon database is used.
- [ ] **Step 5: Verify the Vercel route budget** in `vercel.json`: `api/index.ts` remains at `maxDuration: 300`, which covers the rewritten Telegram webhook on the current catch-all API function. Do not set 30 seconds unless the existing budget/account plan requires that lower cap.
- [ ] **Step 6: Review `git diff --check` and `git status --short`**. Expected: only planned feature files changed; never stage existing unrelated docs or secrets.
- [ ] **Step 7: Commit** any integration fixes with narrowly scoped messages; do not push or deploy without a separate user request.

## Self-Review

- **Spec coverage:** Account linking, hashed/expiring codes, one-to-one ownership, authenticated endpoints, webhook secret, exact Telegraf Express middleware path, immediate acknowledgement after durable encrypted enqueue, leased background processing, `waitUntil()`/300-second Vercel budget, deduplicated `/write`, encrypted Entry payload, bounded recall, Neon-cache fallback for transient 502/503/504/timeouts, sanitized errors, five-source/768-token budget, source blob IDs, local/cloud model limits, two bilingual CTA placements, Settings code form, environment docs, and full verification each map to Tasks 1–7.
- **Step scan:** Each task starts with a named failing test, runs it red, implements the smallest behavior, reruns it green, and has a scoped commit. No application code is included in this plan.
- **Type consistency:** Repository job-payload and lifecycle interfaces are defined in Task 1 and consumed by the Telegraf ingress and background worker in Task 3, then by write/chat tasks 4–5.
- **Review Focus coverage:** Code expiry/conflict/cooldown is pinned in Task 1–2; forged webhook, durable-enqueue acknowledgement, and single-response behavior in Task 3; duplicate update and durable Entry/write-intent behavior in Task 1/3/4; input/output size/Unicode and cache fallback boundaries in Task 4–5; model/Walrus failure and receipts in Task 4–5.
- **Proportion:** Seven testable tasks keep persistence, account-link API, webhook/onboarding, journal writes, chat, UI, and overall verification separable while keeping the Telegram adapter in one coherent module.
