# Changelog

Notable changes to WalPen are recorded here. Dates use `YYYY-MM-DD`.

## 2026-09-30 — Cloud deployment and Sui wallet sign-in

WalPen's production API and journal cache now run on Vercel and Neon. The public application no longer needs the developer's computer, local API or temporary tunnel to stay online. Visitors can authenticate with a Sui wallet and configure a personal cloud AI key.

Implementation: [625c492](https://github.com/Olympusxvn/WalPen/commit/625c492) and [52c6739](https://github.com/Olympusxvn/WalPen/commit/52c6739).

### Added

- **Sui wallet sign-in:** connect a wallet and approve a personal-message signature. The application does not request a transaction or gas payment for authentication. First-time registration remains invitation-only.
- Wallet linking for existing password accounts, preserving their journal identity and Walrus namespace. Password sign-in remains available.
- Browser-bound authentication challenges with a unique nonce, five-minute expiry, address verification and single-use consumption to prevent replay.
- English/Vietnamese settings for personal Gemini and OpenAI API keys and model selection. Keys are scoped to the user's browser-tab session and cleared on logout; WalPen does not persist them in Neon or Walrus.
- A PostgreSQL repository shared by Vercel function instances, plus a one-time SQLite migration script that backs up the source and refuses a populated destination.
- Cloud deployment documentation and a Vietnamese guide for collecting real feedback across several days of friend testing.

### Changed

- Routed production API requests to a Vercel function instead of a temporary Cloudflare tunnel. Neon stores accounts, sessions, encrypted journal records, consent and synchronization receipts. Walrus Memory remains responsible for durable memory storage and semantic recall.
- Migrated existing accounts and journal revisions without changing user IDs, password hashes, encrypted payloads or memory namespaces. The original SQLite database remains a private backup.
- Registered background synchronization with Vercel `waitUntil()`. Database-backed claims coordinate submissions across function instances; persisted job IDs allow confirmation checks to resume on later journal requests.
- Kept ambiguous write outcomes distinct from confirmed failures. Abandoned submissions without a saved job ID become uncertain rather than being blindly retried.
- Kept Ollama and SQLite available through the local installer. Production chat uses personal cloud-provider keys.
- Updated the README, article draft and submission checklist to distinguish cloud operation from earlier local/Ollama experiments and synthetic fixtures from real usage.
- Documented the relationship between MemWal [#277](https://github.com/MystenLabs/MemWal/issues/277) and [#592](https://github.com/MystenLabs/MemWal/issues/592): serverless latency budgets and SDK token budgets address related but different limits. WalPen retains the token-budget integration from PR #605.

### Fixed

- Enabled TypeScript relative-import extension rewriting so emitted server JavaScript resolves its internal modules on Vercel, fixing the initial cloud runtime failure.
- Added a guard to the legacy tunnel startup script so it cannot overwrite the cloud API routing.
- Clear the active application's account and conversation state when a connected wallet changes or disconnects.

### Verified

- Passed 27 local regression tests and one live-Neon integration test using an isolated temporary schema.
- Built and deployed the cloud application; confirmed public API health after stopping the old local API and tunnel.
- Verified migrated-account login and journal retrieval. A fictional entry written through the cloud API received a confirmed Walrus blob receipt.
- Verified production wallet connection, personal-message signing and session persistence after reload in Edge using a synthetic unfunded wallet.
- Checked English/Vietnamese personal-key settings with mocked API responses. Scanned 63 source files without finding configured secrets.

### Known limitations and pending review

- **Slush blocks the website with a “Malicious website” warning.** The owner confirmed submitting a review request. No clearance or detection explanation has been received. The synthetic-wallet test above did not exercise Slush's security screening; it does not establish that Slush sign-in is available. Do not bypass the warning. Investigation notes are in [SLUSH-REVIEW.md](docs/SLUSH-REVIEW.md).
- A successful Gemini/OpenAI response with a valid personal API key has not yet been verified. Provider access, quota and charges depend on the visitor's account.
- Background execution remains bounded by Vercel's function lifetime. Uncertain writes may still require reconciliation; in-process rate limits are best-effort across instances.
- Multi-day use by real participants and their feedback remain pending. The article is still a draft; automated tests and dated fixtures do not establish real adoption.

Operational details: [cloud deployment](docs/CLOUD-DEPLOYMENT.md). Tester instructions: [Vietnamese friend-testing guide](docs/FRIEND-TEST-GUIDE.vi.md).
