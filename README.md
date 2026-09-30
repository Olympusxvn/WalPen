<div align="center">

# WalPen

### *A quiet journal. A companion that remembers what you choose.*

English · Tiếng Việt · Walrus Memory · Local Ollama inference

[![Walrus Sessions](https://img.shields.io/badge/Walrus_Sessions-Chatbots_That_Remember-456954?style=for-the-badge)](https://thewalrussessions.wal.app/chatbots/index.html)
[![Stage](https://img.shields.io/badge/Stage-Working_Demo-858b7f?style=for-the-badge)](docs/IMPLEMENTATION-STATUS.md)

[![Live demo](https://img.shields.io/badge/Try_WalPen-Vercel-304737?style=for-the-badge&logo=vercel&logoColor=white)](https://walpen.vercel.app)
[![Integration notes](https://img.shields.io/badge/Read-Integration_Notes-456954?style=for-the-badge)](docs/MEMWAL-PR-INTEGRATION.md)
[![Source](https://img.shields.io/badge/Source-GitHub-304737?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Olympusxvn/WalPen)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)](package.json)
[![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](package.json)
[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![MemWal](https://img.shields.io/badge/MemWal_SDK-0.1.7-456954?style=flat-square)](server/memory.ts)
[![Ollama](https://img.shields.io/badge/Ollama-Qwen3_4B-304737?style=flat-square)](server/llm.ts)

![WalPen: a journal, an approved memory card and a conversation recalling the same park scene.](docs/assets/walpen-article-cover.png)

*Concept illustration, not an application screenshot.*

> Write a page → approve a memory excerpt → return to a fresh conversation.

</div>

WalPen is a journaling app for people who want continuity between conversations and a clear choice about which parts of their writing a chatbot may recall. Users write their own entries, select an editable memory excerpt, and receive answers with references to relevant saved pages.

**Storage and consent are separate:** saving uploads the journal record to Walrus Mainnet. Approval determines which excerpt may enter the chatbot's context. Chat messages are not automatically saved as memories.

<a id="contents"></a>
## 📑 Contents

| Explore | Build and operate |
|:---|:---|
| [For reviewers](#for-reviewers) | [Quick start](#quick-start) |
| [Journal and memory workflow](#workflow) | [Configuration](#configuration) |
| [Architecture](#architecture) | [Scripts and verification](#scripts) |
| [Mainnet evidence](#mainnet) | [Deployment](#deployment) |
| [MemWal contributions](#contributions) | [Privacy and recovery](#privacy) |
| [Documentation](#documentation) | [Project status](#status) |

<a id="for-reviewers"></a>
## 🔎 For reviewers

**Run on your own computer:** follow [SETUP.md](SETUP.md), then run `npm run setup:local`. It prepares a separate local profile, installs dependencies, downloads the Ollama model and starts WalPen. A journal-only option is available without Ollama; Walrus memory requires your own MemWal credentials.

**Start with the [live demo](https://walpen.vercel.app).** Choose **VI** or **EN**, then register using the demo invitation code `walpen-sessions-2026`. The API and Ollama run on the developer's computer; account access and chat require that host and its tunnel to remain online.

1. Write a short fictional entry with a fact you can check, such as a planned activity.
2. Select the excerpt the companion may remember, approve it, save, and wait for **Saved on Walrus**.
3. Open a fresh chat, enable memory, and ask about that fact. Inspect the source card and blob ID.
4. Start another fresh chat with memory disabled and ask the same question in the same language.
5. Withdraw the excerpt from future use, then start a fresh conversation to check the change.

To check the code without making Mainnet writes or calling an LLM, use Node.js 24.x:

```bash
npm ci
npm test
npm run build
```

| 🔗 Resource | 📍 What to inspect |
|:---|:---|
| [Implementation status](docs/IMPLEMENTATION-STATUS.md) | Verified behavior, remaining work and operating limits |
| [MemWal integration notes](docs/MEMWAL-PR-INTEGRATION.md) | Token budgeting, deletion filtering and the deployed test |
| [Integration tests](tests/app.test.ts) | User isolation, consent, revisions and write recovery |
| [Memory budget tests](tests/memory-context.test.ts) | Whole excerpts, Unicode, source limits and estimates |

<a id="workflow"></a>
## 🌿 Journal and memory workflow

| Capability | Behavior |
|:---|:---|
| Write and revisit | Journal pages, moods, search, per-user drafts, immutable revisions and JSON/Markdown export |
| Choose what the companion recalls | Editable excerpts with explicit approval; memory on/off for each conversation |
| Continue across sessions | Semantic recall from Walrus with entry dates and blob IDs in source cards |
| Keep context bounded | Up to five approved sources and 768 estimated memory-context tokens; complete excerpts are retained |
| Change your mind | Withdrawn and superseded entries are filtered out; a concurrent edit or withdrawal prevents returning an obsolete answer |
| Use either language | English/Vietnamese interface, remembered language preference, localized dates and model response language |
| See the actual storage state | Pending, confirmed, failed and uncertain outcomes; service errors are shown instead of simulated success |

Switching the interface language does not translate or overwrite journal content. The companion supports reflection; it is not intended to diagnose users or write their diary for them.

<a id="architecture"></a>
## 🏗️ Architecture

```mermaid
flowchart TD
    UI[React interface on Vercel] -->|HTTPS through temporary tunnel| API[Authenticated Node API]
    API <-->|Journal revisions and job state| DB[Encrypted SQLite cache]
    API -->|Remember and recall in user namespace| MW[MemWal relayer]
    MW <-->|Encrypted memory blobs| WAL[Walrus Mainnet]
    API -->|Chat and approved recalled excerpts| LLM[Local Ollama / Qwen3]
    LLM -->|Answer| API
    API -->|Answer and source references| UI
```

| Layer | Responsibility |
|:---|:---|
| [React + Vite](src/App.tsx) | Journal editor, consent controls, chat and bilingual navigation |
| [Express API](server/app.ts) | Authentication, server-side user isolation, revision checks and background write handling |
| [MemWal adapter](server/memory.ts) | `MemWal.create()`, `remember()`, `waitForRememberJob()` and `recall()` |
| [Context budget](server/memory-context.ts) | Filtered excerpts bounded with SDK helpers before generation |
| [Ollama adapter](server/llm.ts) | `qwen3:4b-instruct-2507-q4_K_M`, language instructions and citation handling |
| [SQLite store](server/store.ts) | Encrypted journal payloads, accounts, sessions and recovery state |

The API derives namespaces from authenticated user IDs. After recall, it validates blob identity, the active revision, consent and the approved excerpt before passing context to Ollama. It checks selected sources again after generation to catch edits or withdrawals made while the model was answering.

The 768-token budget covers the serialized memory context only. It uses MemWal's character-based estimate, not exact Qwen tokenization or a limit on the entire prompt.

<a id="quick-start"></a>
## ⚡ Quick start

**Prerequisites:** Node.js **24.x**, npm, [Ollama](https://ollama.com/download), and a Walrus Memory account with a delegate key for live storage.

```bash
git clone https://github.com/Olympusxvn/WalPen.git
cd WalPen
npm ci
```

Create your configuration once. In PowerShell:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

On macOS/Linux, use `cp .env.example .env` instead. Put the generated hex value in `DATA_ENCRYPTION_KEY`, fill in the remaining settings below, and keep the file local. Preserve an existing `.env` and encryption key when updating an installation.

```bash
ollama pull qwen3:4b-instruct-2507-q4_K_M
npm run dev
```

Ensure Ollama is running. Open **http://localhost:5173** and register with a password of at least 10 characters. This pilot has no password-reset flow.

<details>
<summary><strong>Serve the production build locally</strong></summary>

Set `APP_MODE=development` and `APP_ORIGIN=http://localhost:3001` in your local `.env`, then run:

```bash
npm run build
npm start
```

Open **http://localhost:3001**. The development frontend uses port 5173; the standalone build uses port 3001. Public deployments use the HTTPS configuration described below.

</details>

<a id="configuration"></a>
## ⚙️ Configuration

Use [.env.example](.env.example) as the starting point. Delegate credentials are read by the backend and must never be placed in a frontend `VITE_*` variable.

| Variable | Local setup |
|:---|:---|
| `DATA_ENCRYPTION_KEY` | Your generated 64-character hex key; retain it with your backup plan |
| `MEMWAL_ACCOUNT_ID` | Your MemWalAccount object ID |
| `MEMWAL_PRIVATE_KEY` | Your private delegate key |
| `MEMWAL_SERVER_URL` | `https://relayer.memory.walrus.xyz` |
| `LLM_PROVIDER` | `ollama` |
| `LLM_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` |
| `LLM_BASE_URL` | `http://127.0.0.1:11434` |
| `APP_MODE` | `development` locally; `production` for the public demo |
| `APP_ORIGIN` | `http://localhost:5173` for development |
| `PORT` | `3001` by default |
| `INVITE_CODE` | Optional locally; required in production |
| `DATABASE_PATH` | Optional; defaults to `data/walpen.sqlite` |

For the documented Ollama setup, leave `LLM_API_KEY` empty. Other provider adapters exist in the code; the recorded demo and evidence use the Qwen/Ollama configuration above.

<a id="mainnet"></a>
## ⛓️ Mainnet evidence

Verification recorded through **29 September 2026**:

| Check | Recorded result |
|:---|:---|
| Initial Mainnet verification | Ten distinct confirmed blobs, followed by recall from a new client |
| Browser journal | A separate page saved through the app and opened through the public deployment |
| Five fictional pages | All five questions returned the expected fact and source after recovery from three failed writes |
| Public recall on 29 September | Correct park / 20-minute answer, five sources, 201 estimated memory-context tokens, about 80 seconds on the local CPU host |
| Automated validation | 16 tests and production build passed for commit [`3edbe27`](https://github.com/Olympusxvn/WalPen/commit/3edbe27c084f022df79b4e345317c67c677f2af1) |

These are synthetic test results, not claims of real-user adoption or general model accuracy. The five pages carry different journal dates but were created and tested on 19 September.

<details>
<summary><strong>Public demo identifiers and local evidence files</strong></summary>

| Identifier | Value |
|:---|:---|
| MemWalAccount object ID | `0xd7ec125eb467c0cce65b219ff7ddeea217c16709077c2c48c183e47e80704287` |
| Delegate public key | `3d459de074104123300bb8ccc4367d24cf3c6e7656edcbe46ab1f91d10a4415f` |
| Network | Walrus Mainnet |

The account object ID is not a prize-recipient wallet address. These identifiers refer to the demo; use your own account and private delegate credentials when running a separate installation.

Local evidence is intentionally excluded from Git:

- `data/evidence/walrus-verification.json` — initial jobs, blob IDs and fresh-client recall.
- `data/evidence/public-e2e.json` — memory-off / memory-on responses.
- `data/evidence/five-days.json` and `five-days-report.md` — fictional-page checks and recovery results.
- `data/evidence/pr-integration-live.json` — public check after the MemWal integration update.

Public summaries are in [implementation status](docs/IMPLEMENTATION-STATUS.md), [integration notes](docs/MEMWAL-PR-INTEGRATION.md) and the [incident report](docs/MEMWAL-ENCRYPTION-INCIDENT.md).

</details>

<a id="contributions"></a>
## 🔌 MemWal contributions and adoption

WalPen adopts two improvements associated with earlier Session 7 feedback and adds three reports from the Session 8 build.

| Contribution | Connection to WalPen |
|:---|:---|
| [#591](https://github.com/MystenLabs/MemWal/issues/591) / [PR #885](https://github.com/MystenLabs/MemWal/pull/885) | The discussion separated asynchronous write timing from Security Delete behavior. The PR addresses the narrower server-side deletion filter; it does not establish a general stale-after-forget bug. |
| [#592](https://github.com/MystenLabs/MemWal/issues/592) / [PR #605](https://github.com/MystenLabs/MemWal/pull/605) | SDK token budgeting now bounds WalPen's approved memory context while retaining complete excerpts. |
| [#1047](https://github.com/MystenLabs/MemWal/issues/1047) | Historical encryption-backend failures, with job IDs, timing and subsequent recovery evidence. |
| [#1048](https://github.com/MystenLabs/MemWal/issues/1048) | A durable recovery guide for timeouts and process restarts using existing SDK APIs. |
| [#1049](https://github.com/MystenLabs/MemWal/issues/1049) | A proposed read-only receipt lookup by idempotency key when the original job ID was lost. |

The hosted relayer's reported build contains #885's exclusion query; runtime activation depends on its schema/configuration. WalPen retains its own consent and revision checks. The receipt-lookup API in #1049 remains a proposal. See [integration boundaries](docs/MEMWAL-PR-INTEGRATION.md).

<a id="scripts"></a>
## 🧪 Scripts and verification

| Command | Purpose and requirements |
|:---|:---|
| `npm run dev` | Watch the API and serve the Vite frontend |
| `npm test` | Isolated automated tests; no Mainnet writes or model calls |
| `npm run build` | Type-check and build the frontend |
| `npm start` | Start the API and serve an existing `dist/` build |
| `npm run check:secrets` | Check source files for configured secret values; not a comprehensive secret detector |
| `npm run backup` | Create a consistent encrypted SQLite snapshot |
| `npm run verify:walrus` | **Real Mainnet writes:** ten fictional facts and fresh-client recall; requires configured MemWal access and available storage funding |
| `npm run verify:public` | Live login and chat check; requires `E2E_USERNAME`, `E2E_PASSWORD`, the demo's riverside-memory fixture and a running backend/model |
| `npx tsx scripts/test-five-days.ts` | Live fictional-page evaluation; may create entries or replacement revisions and make Mainnet writes |

Live API checks default to `https://walpen.vercel.app`; set `E2E_BASE_URL` to test your deployment. Keep test credentials local. The Mainnet verification script persists jobs in `data/evidence/`, resumes known jobs, skips confirmed blobs and stops on ambiguous submissions rather than blindly reposting.

<a id="deployment"></a>
## 🌐 Deployment

**Vercel hosts the frontend.** The Node API, SQLite database and Ollama run on a persistent local host reached through a Cloudflare Quick Tunnel.

1. Test and build locally. Keep Ollama running with the configured model.
2. Set `APP_MODE=production`, `APP_ORIGIN=https://your-public-domain` and an `INVITE_CODE` in the backend's `.env`; restart the API.
3. Tunnel to `http://127.0.0.1:3001` and update the `/api/:path*` destination in [vercel.json](vercel.json).
4. Retain the API `no-store` headers and disabled external-rewrite caching.
5. Deploy the frontend using Vercel CLI. [.vercelignore](.vercelignore) excludes local secrets, data and backend files.
6. Check login, a confirmed write and recall from a fresh chat through the public domain.

For the existing Windows demo, [scripts/start-demo.ps1](scripts/start-demo.ps1) can launch the API and tunnel, update the rewrite and deploy:

```powershell
.\scripts\start-demo.ps1 -Deploy
```

This helper expects the official `cloudflared.exe` at `data/tools/cloudflared.exe`, an authenticated Vercel CLI session and the existing `olympusxvns-projects` scope. Adjust that scope for your own deployment. Check existing processes before starting another tunnel.

Quick Tunnel URLs change after restart, so the rewrite must be redeployed. Production cookies require HTTPS; a local HTTP session does not work in production mode. Unattended hosting needs a stable backend host and domain.

<a id="privacy"></a>
## 🔒 Privacy, consent and recovery

- Journal payloads in SQLite use **AES-256-GCM**. Account/session metadata remains in SQLite; passwords use salted scrypt and production sessions use HttpOnly/SameSite/Secure cookies.
- The hosted MemWal relayer processes plaintext for embedding and encryption. The local API can decrypt the cache, and Ollama receives the chat input and approved recalled excerpts. This is not end-to-end encryption or a fully offline application.
- The pilot uses a shared MemWal account with namespaces derived server-side. This provides application-level user isolation, not independent cryptographic ownership for every user.
- **Stop remembering** excludes an entry from future prompts and creates a stored revision. It does not delete old Walrus blobs or erase text already returned in a conversation.
- Recalled content is treated as untrusted data. WalPen has no tool-executing agent; model resistance to malicious text is not a formal guarantee.

### Back up and restore

```bash
npm run backup
```

Snapshots are stored under `data/backups/`. Keep the database **and** its encryption key, backed up separately. Changing the key without migrating encrypted records makes those records unreadable.

To restore, stop WalPen, point `DATABASE_PATH` to a copy of a snapshot, keep the same `DATA_ENCRYPTION_KEY`, and restart. Test the copy on a separate port before replacing the live database. Snapshots preserve user mappings, current revisions and withdrawn-memory state.

MemWal's `restore` repairs its search index; it does not reconstruct WalPen accounts or the local database. Full recovery from Walrus alone is not implemented. JSON/Markdown exports preserve readable journal content, not the complete account state.

<a id="documentation"></a>
## 📚 Documentation

| 📄 Document | 📍 Purpose |
|:---|:---|
| [Implementation status](docs/IMPLEMENTATION-STATUS.md) | Verified results and outstanding work |
| [MemWal PR integration](docs/MEMWAL-PR-INTEGRATION.md) | #605/#885 adoption and validation |
| [Article draft](docs/ARTICLE-EN.md) | Build story, before/after and integration lessons; not yet published on Medium/Inkray |
| [Submission checklist](docs/SUBMISSION-CHECKLIST.md) | Readiness against Event Rules and remaining tasks |
| [Editorial notes](docs/ARTICLE-EDITORIAL-NOTES.md) | Keywords, evidence sources and writing constraints |
| [Encryption incident](docs/MEMWAL-ENCRYPTION-INCIDENT.md) | Evidence behind #1047 |
| [Recovery documentation ticket](docs/MEMWAL-RECOVERY-DOCS-TICKET.md) | Scope of #1048 |
| [Receipt lookup ticket](docs/MEMWAL-RECEIPT-LOOKUP-TICKET.md) | Scope of #1049 |
| [Submission draft](docs/SUBMISSION-DRAFT.md) | Project description and evidence to prepare |
| [Contribution summary](ISSUE.txt) | Prior core contributions and new Session 8 feedback |

<details>
<summary><strong>Earlier proposals and related resources</strong></summary>

- [Original feedback drafts](docs/MEMWAL-FEEDBACK-PROPOSALS.md) — historical drafts superseded by the published recovery tickets.
- [Structured recovery proposal](docs/MEMWAL-JOB-RECOVERY-FEATURE.md) — an additional unsubmitted idea.
- [MemWal source and issues](https://github.com/MystenLabs/MemWal).
- [Walrus Sessions Event Rules](https://thewalrussessions.wal.app/chatbots/index.html).
- [DeepSurge event page](https://www.deepsurge.xyz/hackathons/c0141a4a-21be-4009-bc63-7c168608c849).
- [Pause & Pen](https://github.com/Olympusxvn/pause-and-pen) — the original product inspiration.

</details>

<a id="status"></a>
## ✅ Project status

- [x] Bilingual journal and locally served Qwen companion.
- [x] Confirmed Mainnet writes and fresh-session recall with source references.
- [x] Consent/revision filtering, memory budgeting and recovery tests.
- [x] Public frontend and documented local backend setup.
- [x] Three new MemWal feedback tickets from the Session 8 build.
- [ ] Documented real-user feedback beyond synthetic fixtures.
- [ ] Always-on backend and full recovery from Walrus alone.
- [ ] Published article/social links, dedicated Sessions wallet and final submission confirmation.

No license file is currently included in this repository.

---

<div align="center">

**WalPen** · *A little room for yourself.*

[![GitHub stars](https://img.shields.io/github/stars/Olympusxvn/WalPen?style=social)](https://github.com/Olympusxvn/WalPen/stargazers)

Inspired by Pause & Pen. Built as a new implementation with Walrus Memory and Ollama.

</div>
