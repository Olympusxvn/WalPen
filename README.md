# WalPen

**A little room for yourself.** A calm journal and an Ollama companion that recalls only the memories you approve, persisted through Walrus Memory on Mainnet.

[Live demo](https://walpen.vercel.app) — choose **VI / EN** in the header. The demo API requires the local host and tunnel to remain online.

Inspired by [Pause & Pen](https://github.com/Olympusxvn/pause-and-pen). This repository contains a new implementation: the reference repository contained a README, not reusable application code.

## Run locally

Requires Node.js 24+, an installed [Ollama](https://ollama.com/download), a Walrus Memory account and delegate key.

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Put that generated value into DATA_ENCRYPTION_KEY in .env.
# Set MEMWAL_ACCOUNT_ID, MEMWAL_PRIVATE_KEY, LLM_PROVIDER=ollama,
# LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M and LLM_BASE_URL=http://127.0.0.1:11434.
ollama pull qwen3:4b-instruct-2507-q4_K_M
npm run dev
```

Open http://localhost:5173. Register a username and a password of at least 10 characters. There is no password-reset flow in this pilot; retain your password.

```powershell
npm test
npm run build
npm start
```

`npm start` serves the built application and API on port 3001. Set `APP_ORIGIN=http://localhost:3001` when using this standalone local build. The development frontend uses port 5173.

## What works

- Private accounts, hashed passwords, expiring HttpOnly sessions and server-side user isolation.
- English / Vietnamese interface, persistent language preference, localized dates and model response language. Changing language does not translate or overwrite journal content.
- Per-user drafts, journal pages, mood selection, search, revisions and JSON/Markdown export.
- Explicit, editable memory consent. Saving a journal uploads the page; only the separately approved memory excerpt can enter chat context.
- Walrus background jobs with pending, confirmed and ambiguous states. Timeouts with a known job poll that same job. An ambiguous submission is reconciled by ID and never blindly resubmitted.
- Fresh-session semantic recall from Walrus; source cards include date and blob ID.
- Ollama chat. Unavailable services produce errors, not simulated AI or fake storage success.
- Withdrawn or superseded entries are excluded from subsequent recall. Withdrawal creates a new stored revision and stops local retrieval immediately.
- An explicit memory on/off control for before/after evaluation. Starting a new chat removes the current transcript.

## Data and privacy

Browser → authenticated Node API → MemWal relayer → encrypted Walrus blobs.

The API keeps an AES-256-GCM encrypted SQLite cache for exact journal lookup, export, revisions and write-job recovery. Sessions and basic account metadata remain in SQLite; passwords use salted scrypt. Back up the database **and** the encryption key separately. Never rotate the data encryption key without migrating encrypted records.

The hosted relayer sees plaintext to embed and encrypt it. The local backend can decrypt the cache. Ollama receives the current chat and approved retrieved excerpts. This is not end-to-end encryption or a fully offline application. Do not claim that only the user can read their data.

Namespaces are generated from authenticated server-side user IDs. Browser-supplied namespaces are never accepted. A shared pilot account is a custody tradeoff, not independent cryptographic ownership for every user.

“Stop remembering” excludes an entry from future prompts; it does **not** delete old Walrus blobs. The app has no tool-executing agent. Recalled content is treated as untrusted data. Model-level resistance to malicious text is not a formal guarantee.

## Backup and recovery

```powershell
npx tsx scripts/backup.ts
```

This creates a consistent encrypted SQLite snapshot under `data/backups/`. To restore, stop WalPen and set `DATABASE_PATH` to a copy of a snapshot; use the same `DATA_ENCRYPTION_KEY`, then restart. The snapshot retains user identity mappings, current revisions and revoked-memory state. Test a snapshot on a separate port before switching the live app.

MemWal's `restore` repairs its own search index; it does not reconstruct WalPen accounts or the entire local database. Complete recovery from Walrus alone is not implemented in this pilot. Loss of both the application database and backups loses those mappings. JSON exports are readable journal backups, not account-restoration files.

## Mainnet verification

```powershell
npm run verify:walrus
```

This explicitly writes ten fictional demonstration facts, saves job/blob evidence in ignored `data/evidence/`, then uses a fresh client to recall without a transcript. It performs real writes; ordinary tests use isolated fakes and never spend storage or call a model. Rerunning the script resumes known jobs and skips confirmed blobs.

## Deployment: Vercel frontend + local Ollama backend

Ollama and the persistent SQLite database run on a long-lived host. They are not placed inside Vercel Functions. Vercel serves the frontend and rewrites `/api/*` to the temporary backend tunnel. Keep the host and tunnel running for the demo.

1. Build and test locally.
2. Start a Cloudflare Quick Tunnel to `http://127.0.0.1:3001`.
3. Set the tunnel destination in `vercel.json` rewrites. API responses must be `no-store` and external rewrite caching disabled.
4. Set `APP_MODE=production`, `APP_ORIGIN` to the exact public Vercel URL and a private `INVITE_CODE` in local `.env`; restart the backend. HTTPS uses Secure cookies. A local HTTP session does not work in production mode.
5. Deploy the frontend with Vercel CLI. `.vercelignore` excludes all local secrets, databases and backend files.
6. Verify registration/login, a real write and fresh-session recall through the public domain.

A Quick Tunnel URL changes after restart. Update the rewrite and redeploy when it changes. This is suitable for a temporary demonstration, not unattended hosting. A permanent deployment needs a durable backend host and stable domain.

## Scope still requiring human participation

Real-user testing, the final article's actual-use evidence, a dedicated Sessions wallet and the final competition submission cannot be fabricated. Draft materials are in `docs/`; fill unverified fields only with observed evidence. Check current event rules before submitting.

## Stack

React, TypeScript, Vite, Express, Node SQLite, MemWal SDK, Ollama. No analytics, trackers, external fonts or automatic memory extraction.
