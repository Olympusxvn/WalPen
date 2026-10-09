# WalPen Telegram Channel — Design

**Date:** 2026-10-09  
**Status:** Approved in chat; awaiting document review  
**Purpose:** Add Telegram as an alternate WalPen access channel, including secure account linking, journal writes, memory-backed chat, and bilingual UI entry points.

## Agreed behavior

- `/start` checks whether the Telegram account is linked to a WalPen user. If not, it issues a short-lived, single-use code and explains how to paste it in the signed-in WalPen Settings page.
- A normal text message starts a chat. `/chat <question>` explicitly starts a memory-backed chat. `/write <text>` saves a journal entry and approves that submitted text for Walrus Memory.
- Telegram replies use the configured server-side model. Local Ollama works when the local WalPen server runs; Vercel cloud runs require an online server-configured provider. The browser's session-only BYOK key is not persisted or reused by Telegram.
- The UI has a bilingual Telegram action next to the language selector and a second action in the home chat invitation. Signed-in Settings offers a Telegram linking-code field and linked status.

## Architecture

Use Telegraf's webhook callback inside the existing Express application, in a new `server/channels/telegram.ts` module. The existing `api/index.ts` remains the Vercel entry point and its initialized `PostgresStore`, `MemoryGateway`, `ChatModel`, and background scheduler are injected into the channel module. This keeps Telegram on the same account, encryption, memory, and model paths as the web app. It avoids a second Vercel runtime or an independently deployed worker.

Mount `/api/telegram/webhook` before the normal browser-session authentication middleware. Require `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`; use Telegraf's webhook secret-token validation. The route must not depend on a user cookie. A missing or invalid Telegram configuration leaves the webhook unavailable without breaking the rest of the API.

Do not expose or fetch `DATA_ENCRYPTION_KEY` from an HTTP endpoint. Telegram creates a normal `Entry` through the injected `Repository`; `PostgresStore.insert()` encrypts the journal payload with the existing AES-256-GCM helper. `DATA_ENCRYPTION_KEY` stays inside the server runtime.

## Account linking and persistence

Add repository operations and matching SQLite/Neon schema for Telegram link codes, account links, and inbound update deduplication. Link codes are generated with a cryptographically secure random source, stored only as a digest, bound to a Telegram ID, expire after ten minutes, and are consumed atomically. A Telegram ID and a WalPen user ID each have at most one active link. Linking is initiated only from an authenticated WalPen session through `POST /api/telegram/link`; `GET /api/telegram/status` returns the current user's linked state. Rate-limit code creation and redemption.

Deduplicate Telegram updates so webhook retries cannot create multiple journal entries or repeat completed commands. For `/write`, the update claim and entry insertion must be durable before replying that the journal was accepted. The entry is queued with its memory text approved; after the quick Telegram acknowledgement, schedule the existing `synchronize()` path through the injected background callback (`waitUntil()` on Vercel). Return honest queued/synced/error states and never claim a Walrus receipt before confirmation.

## Memory-backed chat

For ordinary text and `/chat`, resolve the Telegram ID to the linked WalPen user, call the same `MemoryGateway.recall()` path as web chat, and pass results through `selectRecallContext()` with all current consent, active-entry, blob, and relevance checks. Use `budgetMemoryContext()` unchanged, preserving the maximum of five sources and 768 estimated tokens. Pass only the approved sources and current prompt to the configured `ChatModel`; do not send Telegram chat history as remembered facts. Return concise Telegram-sized replies and append source cards with the full Walrus blob IDs used for the answer.

Vercel's current runtime rejects `LLM_PROVIDER=ollama`, so cloud Telegram chat uses server environment configuration (`LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY`) for Gemini/OpenAI. Browser BYOK remains session-only and is intentionally out of scope for bot credentials.

## Frontend and configuration

The current UI is in `src/App.tsx` and `src/style.css`; there are no `src/components/MainLayout.tsx`, `src/components/Readme.tsx`, or `src/pages/Settings.tsx` files. Add a localized action next to the VI/EN switch and another action to the home chat invitation. Read the destination from `VITE_TELEGRAM_BOT_URL`, using `https://t.me` only as an explicit sample default until the actual bot username is configured.

Add a code input and linked-state view within the existing Settings page. It is available to signed-in users only, calls the authenticated API endpoints, and does not place link codes into URLs or browser storage. Explain that messages sent through Telegram are processed by Telegram, WalPen's configured AI provider for chat, and Walrus Memory when saved via `/write`.

Document the required server variables and webhook setup steps in `.env.example` and `SETUP.md`. Do not add real tokens or change Vercel secrets as part of this code task.

## Validation

- Unit/API tests cover link-code expiry, one-time consumption, one-to-one mapping, brute-force throttling, forged webhook rejection, and Telegram update deduplication.
- Tests assert Telegram `/write` stores an AES-GCM encrypted Entry through the repository, queues the existing Walrus synchronization path, and cannot duplicate an entry on webhook retry.
- Tests cover recall filtering/budgeting (five sources, 768 estimated tokens) and blob IDs in chat responses without calling real Telegram, AI, Neon, or Walrus services.
- UI tests/build verify both localized Telegram actions and the authenticated settings link form.
- Run the full existing test suite and production build.

## References

- [Telegraf webhook callback and secret-token options](https://telegraf.js.org/classes/Telegraf-1.html)
- [Vercel Functions `waitUntil()` API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
