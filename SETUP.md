# WalPen — local setup for judges and guests

Run WalPen on your own computer, without the public demo's tunnel. This guide also serves as an execution runbook for an AI coding agent: **“Read SETUP.md and set up WalPen locally.”** It is a repository guide, not an automatically installed Codex/Cursor skill.

## Quick start

Install **[Node.js 24.x](https://nodejs.org/en/download)** first. For chat, also install **[Ollama](https://ollama.com/download)**. Reopen your terminal after installation. Git is optional if you download and extract the repository ZIP instead.

```bash
git clone https://github.com/Olympusxvn/WalPen.git
cd WalPen
npm run setup:local
```

Already cloned the repository? Run only the last command from its folder.

The command creates a private local configuration, checks/starts installed Ollama, downloads `qwen3:4b-instruct-2507-q4_K_M` if needed, installs the locked npm dependencies, builds the UI, and starts WalPen. The first run needs internet access and several GB of free disk space for the model. Download and response times depend on your connection and hardware. OS-level installation of Node.js and Ollama is a prerequisite; the script does not install those applications.

When the terminal says **WalPen ready**, open **[http://localhost:3002](http://localhost:3002)**. Keep the terminal open. Register a new account with a password of at least 10 characters; this local profile does not require an invitation code. Select **EN** or **VI** in the interface.

For a journal-only review without Ollama, use this command on a **fresh local profile**:

```bash
npm run setup:local -- --no-ai
```

Chat is unavailable in this mode; no model responses are simulated. On an existing profile, `--no-ai` preserves your settings: edit `LLM_PROVIDER=` in `data/local/.env` to disable AI.

| Command | Result |
| :--- | :--- |
| `npm run setup:local` | Install, build, prepare Ollama and run |
| `npm run setup:local -- --no-start` | Prepare everything, then exit |
| `npm run setup:local -- --no-ai --no-start` | Prepare a fresh journal-only profile, then exit |
| `npm run start:local` | Run the existing local profile without reinstalling |
| `npm test` | Run application and setup regression tests |

These commands use Node.js on Windows, macOS and Linux. The local setup has been exercised on Windows; macOS/Linux are not separately verified.

## What each mode can demonstrate

| Local configuration | Available | Not demonstrated |
| :--- | :--- | :--- |
| Journal only | Registration, writing, editing, language switch, local persistence | Chat, Walrus storage, semantic memory recall |
| Ollama, no MemWal keys (default) | Journal plus local model chat | Walrus storage, saved-memory recall, blob receipts |
| Ollama plus your MemWal account | Journal, chat, Mainnet writes and memory recall | Depends on relayer/account availability; setup alone is not Mainnet evidence |

Without MemWal configuration, entries remain local and will not receive **Saved on Walrus** confirmation. Local journal pages do not automatically become Ollama memory context.

## Optional: enable Walrus memory

Stop WalPen with **Ctrl+C**. Open **`data/local/.env`** in your editor and fill in your own account credentials:

```dotenv
MEMWAL_ACCOUNT_ID=YOUR_ACCOUNT_ID
MEMWAL_PRIVATE_KEY=YOUR_DELEGATED_PRIVATE_KEY
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
```

Use an account/delegate provisioned for MemWal; see the [MemWal project](https://github.com/MystenLabs/MemWal) for current account setup. Do not paste keys into the article, issue tracker, chat or tracked files. The installer does not distribute the developer's demo credentials or provision/fund a Mainnet account.

Restart with `npm run start:local`. **Saving a journal entry now uploads its journal record to Walrus Mainnet.** Approval controls whether the excerpt can be recalled by chat; it does not make the saved journal record local-only. Use fictional entries for judging. Existing pending entries may also be retried when the backend resumes.

## Judge's walkthrough

1. Register, switch EN/VI, and write a fictional entry: “On Tuesday I walked in the park for 20 minutes.” Reload to verify local persistence.
2. With Ollama enabled, start a chat and verify it returns an actual response. The first response can be slow while the model loads.
3. With MemWal configured, approve a memory excerpt, save a new entry, and wait for **Saved on Walrus**. Inspect its blob ID.
4. Open a fresh chat with memory enabled. Ask “How long did I walk in the park?” Inspect the answer and source card.
5. Repeat in a fresh chat with memory disabled. Withdraw the approved excerpt, then verify a fresh conversation no longer recalls it.

Steps 3–5 require working MemWal credentials; skip them for a local UI-only review. This walkthrough creates data only when you perform those actions. Setup does not seed entries, send chat messages or run the ten-blob Mainnet verification script.

## Files, restart and recovery

| Path | Purpose |
| :--- | :--- |
| `data/local/.env` | Local port, random encryption key, Ollama settings and optional MemWal credentials |
| `data/local/walpen.sqlite` | Local accounts, journal cache and write state |
| `data/local/ollama.log` | Output if setup starts an Ollama server |

The local profile uses port **3002**, binds to loopback, and does not load the root `.env` or the public demo database. Running setup again preserves the existing profile and key. It replaces `node_modules` via `npm ci` and rebuilds `dist`, so stop any local WalPen instance in this checkout before rerunning setup; use a separate clone if the checkout is serving another demo.

- **Restart:** `npm run start:local`; use the same local account. Closing the terminal stops WalPen. An Ollama service started by setup stays running for reuse.
- **Port occupied:** stop your own instance or edit `PORT=3002` to another unused port in `data/local/.env`. Open the new `http://localhost:PORT` address. The launcher derives its origin from that setting and never kills another listener.
- **Ollama unavailable:** install/open Ollama, or run `ollama serve` in another terminal, then rerun setup. See the [official Ollama quickstart](https://docs.ollama.com/quickstart). If model download fails, rerun setup to retry it.
- **Slow chat:** keep Ollama running and allow the first model load to finish. The app has a 120-second model request timeout; a successful model download does not guarantee a response fits that time on every machine.
- **Journal-only → chat:** set `LLM_PROVIDER=ollama`, then run setup again to prepare the model.
- **Back up:** stop WalPen, then copy the entire `data/local/` folder to a private location. Keep the original key and database together. A lost key cannot decrypt the old database; setup refuses to generate a replacement beside an existing database.
- **Write timeout:** retain the database and key. An uncertain write may have reached Walrus; do not blindly resubmit it as a new entry. Consult [write recovery notes](docs/MEMWAL-PR-INTEGRATION.md).

## AI agent execution instructions

When a judge or guest asks an agent to execute this guide:

1. Inspect the checkout, Node version and existing local profile. Never print environment file contents or credentials. Use a separate clone if the current checkout runs a live demo.
2. If Node.js 24.x or Ollama is missing, explain the required official installation. Do not silently install global software, change machine policy or request an administrator shell. Journal-only setup needs no Ollama.
3. Run `npm run setup:local -- --no-start` (or append `--no-ai` for a requested fresh journal-only profile). Preserve existing configuration. Do not reuse production credentials, replace encryption keys, delete data or provision a MemWal account.
4. Run `npm run start:local`, keep the process available, and check `/api/health` returns `{"ok":true}` at the selected local port. Check that `/` serves the WalPen UI. Report the actual URL and whether Ollama/MemWal are configured; do not infer working chat or Mainnet storage solely from a health response.
5. If asked to test chat or memory, use fictional content and the walkthrough above. Report observed results and remaining service errors. Do not deploy, create a public tunnel or run bulk Mainnet writes as part of local installation.

## Tiếng Việt — chạy nhanh

Cài **Node.js 24.x** và **Ollama**, mở lại terminal, vào thư mục WalPen rồi chạy **`npm run setup:local`**. Khi xuất hiện “WalPen ready”, mở **http://localhost:3002**, đăng ký tài khoản mới và chọn **VI**. Lần sau chỉ cần **`npm run start:local`**.

Muốn xem nhật ký mà chưa cài Ollama: dùng **`npm run setup:local -- --no-ai`** cho cấu hình mới. Muốn kiểm chứng lưu/nhớ trên Walrus: điền khóa MemWal của bạn vào **`data/local/.env`** rồi khởi động lại. Khóa và dữ liệu local tách riêng khỏi bản demo; bộ cài không tự tạo dữ liệu mẫu hoặc ghi Mainnet.
