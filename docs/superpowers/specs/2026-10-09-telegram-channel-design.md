# WalPen Telegram Channel — Design

**Date:** 2026-10-09
**Status:** Approved in chat
**Purpose:** Add Telegram as an alternate WalPen access channel, including secure account linking, journal writes, memory-backed chat, and bilingual UI entry points.

## Agreed behavior

- `/start` checks whether the Telegram account is linked to a WalPen user. If not, it issues a short-lived, single-use code and explains how to paste it in the signed-in WalPen Settings page.
- A normal text message starts a chat. `/chat <question>` explicitly starts a memory-backed chat. `/write <text>` saves a journal entry and approves that submitted text for Walrus Memory.
- Telegram replies use the configured server-side model. Local Ollama works when the local WalPen server runs; Vercel cloud runs require an online server-configured provider. The browser's session-only BYOK key is not persisted or reused by Telegram.
- The UI has a bilingual Telegram action next to the language selector and a second action in the home chat invitation. Signed-in Settings offers a Telegram linking-code field and linked status.

## Architecture

Use Telegraf's webhook callback inside the existing Express application, in a new `server/channels/telegram.ts` module. The existing `api/index.ts` remains the Vercel entry point and its initialized `PostgresStore`, `MemoryGateway`, `ChatModel`, and background scheduler are injected into the channel module. This keeps Telegram on the same account, encryption, memory, and model paths as the web app. It avoids a second Vercel runtime or an independently deployed worker.

Mount the Telegram webhook before the normal browser-session authentication middleware using Telegraf's Express middleware directly: `app.use(bot.webhookCallback("/api/telegram-webhook", { secretToken }))`. This middleware owns the webhook response; do not wrap it in another response handler. The ingress handler validates the secret through Telegraf, durably enqueues the encrypted update, registers a background worker, and returns without awaiting recall or model work. Telegraf then returns HTTP 200 after the durable enqueue; do not call `res.send()` separately. If the database enqueue fails, return an error so Telegram can retry. Require `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`; the route must not depend on a user cookie. A missing or invalid Telegram configuration leaves the webhook unavailable without breaking the rest of the API.

The current `vercel.json` already configures `api/index.ts` with `maxDuration: 300`. All `/api/*` requests, including `/api/telegram-webhook`, rewrite to that same catch-all function, so retain the existing 300-second budget rather than lowering it to 30 seconds. The Vercel account's plan still determines the effective ceiling. `waitUntil()` keeps the registered worker alive only within that function invocation and duration; Neon stores each encrypted update and its state so an interrupted worker can be recovered on a later invocation. On each Vercel invocation, schedule a bounded scan of queued/expired Telegram jobs through `waitUntil()`; the local server's existing periodic recovery loop also drains eligible jobs. Do not use untracked `process.nextTick()` work on Vercel.

Do not expose or fetch `DATA_ENCRYPTION_KEY` from an HTTP endpoint. Telegram creates a normal `Entry` through the injected `Repository`; `PostgresStore.insert()` encrypts the journal payload with the existing AES-256-GCM helper. `DATA_ENCRYPTION_KEY` stays inside the server runtime.

## Account linking and persistence

Add repository operations and matching SQLite/Neon schema for Telegram link codes, account links, and a durable inbound job queue. Link codes are generated with a cryptographically secure random source, stored only as a digest, bound to a Telegram ID, expire after ten minutes, and are consumed atomically. A Telegram ID and a WalPen user ID each have at most one active link. Linking is initiated only from an authenticated WalPen session through `POST /api/telegram/link`; `GET /api/telegram/status` returns the current user's linked state. Rate-limit code creation and redemption. Store the queued Telegram update payload with AES-256-GCM, plus status, attempts, lease expiry, and a safe error code; never put raw chat text or technical exception text in queue metadata.

Deduplicate Telegram updates by `update_id` so webhook retries cannot create multiple jobs or journal entries. Return HTTP 200 after the encrypted update is committed to Neon and the worker promise is registered with `waitUntil()`, without waiting for MemWal or the LLM. Process the durable job under a lease and send completed results through `bot.telegram.sendMessage(chatId, answer)` after model work finishes. For `/write`, persist the encrypted Entry and its association with the update before sending a queued confirmation; run the existing `synchronize()` pipeline inside the already-scheduled worker promise (no nested `waitUntil`) and return honest queued/synced/error states. Never claim a Walrus receipt before confirmation.

## Memory-backed chat

For ordinary text and `/chat`, resolve the Telegram ID to the linked WalPen user, call the same `MemoryGateway.recall()` path as web chat, and pass results through `selectRecallContext()` with all current consent, active-entry, blob, and relevance checks. Use `budgetMemoryContext()` unchanged, preserving the maximum of five sources and 768 estimated tokens. Bound remote recall waiting with configurable `TELEGRAM_RECALL_TIMEOUT_MS` (default 8 seconds), using SDK cancellation if the installed SDK supports it and discarding any late result. If MemWal returns a transient network error, timeout, or HTTP 502/503/504, rank only eligible, consented, non-retired, previously synced Neon Entries as a local cache fallback, then pass them through the same five-source and 768-token budget. Label the fallback clearly in the reply; if no eligible cache exists, answer without memories and say so. Never expose raw exception text to Telegram; keep logs sanitized and free of chat content, credentials, and stack traces. Pass only the approved sources and current prompt to the configured `ChatModel`; do not send Telegram chat history as remembered facts. Use `bot.telegram.sendMessage(chatId, answer)` after AI work completes, with concise Telegram-sized replies and source cards containing full Walrus blob IDs.

Vercel's current runtime rejects `LLM_PROVIDER=ollama`, so cloud Telegram chat uses server environment configuration (`LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY`) for Gemini/OpenAI. Browser BYOK remains session-only and is intentionally out of scope for bot credentials.

## Frontend and configuration

The current UI is in `src/App.tsx` and `src/style.css`; there are no `src/components/MainLayout.tsx`, `src/components/Readme.tsx`, or `src/pages/Settings.tsx` files. Add a localized action next to the VI/EN switch and another action to the home chat invitation. Read the destination from `VITE_TELEGRAM_BOT_URL`, using `https://t.me` only as an explicit sample default until the actual bot username is configured.

Add a code input and linked-state view within the existing Settings page. It is available to signed-in users only, calls the authenticated API endpoints, and does not place link codes into URLs or browser storage. Explain that messages sent through Telegram are processed by Telegram, WalPen's configured AI provider for chat, and Walrus Memory when saved via `/write`.

Document the required server variables and webhook setup steps in `.env.example` and `SETUP.md`. Do not add real tokens or change Vercel secrets as part of this code task.

## Validation

- Unit/API tests cover link-code expiry, one-time consumption, one-to-one mapping, brute-force throttling, forged webhook rejection, and Telegram update deduplication.
- Tests assert the webhook returns 200 after durable encrypted enqueue without waiting for delayed recall/LLM work, uses a single Telegraf-owned response, and does not enqueue a forged update.
- Tests assert Telegram `/write` stores an AES-GCM encrypted Entry through the repository, queues the existing Walrus synchronization path, and cannot duplicate an entry on webhook retry.
- Tests cover recall filtering/budgeting (five sources, 768 estimated tokens), transient 502/504/timeout fallback to eligible cached Entries, sanitized user-facing errors, and blob IDs in direct `sendMessage` responses without calling real Telegram, AI, Neon, or Walrus services.
- Verify `vercel.json` retains the existing 300-second `api/index.ts` duration and that the queue remains recoverable if a background invocation expires.
- UI tests/build verify both localized Telegram actions and the authenticated settings link form.
- Run the full existing test suite and production build.

## References

- [Telegraf webhook callback and secret-token options](https://telegraf.js.org/classes/Telegraf-1.html)
- [Vercel Functions `waitUntil()` API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
- [Vercel Function maximum duration configuration](https://vercel.com/docs/functions/configuring-functions/duration)
