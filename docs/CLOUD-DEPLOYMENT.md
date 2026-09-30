# WalPen cloud deployment

Status, 30 September 2026: cloud implementation and database integration tests are prepared. The public site's cutover is pending explicit authorization to transfer the existing MemWal delegate key and journal encryption key into Vercel. The existing public deployment still uses its local backend until cutover is verified.

Verification: 24 local regression tests, one real PostgreSQL integration test using an isolated temporary schema, EN/VI settings checks in Edge with mocked API data, and a successful Vercel preview build (`dpl_4Wx9UbG9gUiBRDiuctBRamnVg5ui`). These do not yet establish a live cloud MemWal write or a successful online-model conversation. Friend testing instructions: [Vietnamese guide and private feedback template](FRIEND-TEST-GUIDE.vi.md).

## What moves to the cloud

| Component | Cloud deployment |
| --- | --- |
| Website and API | Vercel static frontend and `api/index.ts` function |
| Accounts, sessions, consent, journal cache and write receipts | Neon PostgreSQL; journal payloads retain AES-256-GCM encryption |
| Durable memory and semantic recall | Existing MemWal account on Walrus Mainnet |
| Per-user isolation | Existing `walpen-v1-{userId}` namespaces; migration preserves user IDs |
| Chat | Gemini/OpenAI API with a personal key entered in Settings; local Ollama remains available for local installations |

Neon does not replace Walrus recall. Chat still calls `memory.recall()`, verifies the retrieved blob against the user's current approved revision, and applies the memory context budget before sending excerpts to the model. No matching Walrus sources means no fabricated personal memory.

## Operator cutover

1. Connect a Neon Free database to the `walpen` Vercel project. This has been provisioned as `walpen-cloud`, Singapore region. The integration supplies `DATABASE_URL`.
2. With the owner's authorization, add the following **server-side secret environment variables** for production: `MEMWAL_ACCOUNT_ID`, `MEMWAL_PRIVATE_KEY`, `MEMWAL_SERVER_URL`, `DATA_ENCRYPTION_KEY`, `INVITE_CODE`, and `APP_ORIGIN=https://walpen.vercel.app`. Preserve the original encryption key to read the existing ciphertext. Do not set any `VITE_` or `NEXT_PUBLIC_` secret variable. Leave `LLM_PROVIDER` unset for BYOK-only chat.
3. Pull the database connection settings to the ignored file `data/cloud-production.env`. Never print or commit that file.
4. Run `node --import tsx scripts/migrate-to-cloud.ts` during a quiet cutover window. It creates an encrypted SQLite snapshot, refuses a nonempty destination, validates journal ciphertext, and transfers users, active sessions, journal revisions and receipts in a transaction. It makes no MemWal writes. Keep the old database and key as a private backup.
5. Deploy the cloud branch. `vercel.json` routes `/api/*` to the Vercel function, not a temporary tunnel. Do not run `scripts/start-demo.ps1` afterward: that legacy helper rewrites the API back to a local tunnel.
6. Verify `/api/health`, existing-account login, new-account registration, journal persistence, a real MemWal receipt, and recall in a fresh conversation with a valid personal AI key. Keep an explicit distinction between mocked provider tests and a live provider response.
7. Stop the old API/tunnel only after the cloud API is verified. Confirm the public API still works with those processes stopped. The old local database becomes a backup, not an active second writer; copying new rows backward is not part of this migration.

## Write recovery on Vercel

The handler registers background synchronization with `waitUntil()`; this extends work through the request lifecycle but is bounded by the function timeout. PostgreSQL persists the job ID before waiting for the blob receipt. A conditional database update claims each queued entry before submitting it, preventing separate function instances from submitting the same entry twice.

When users open their journal, pending work is checked again. A submission abandoned for ten minutes without a persisted job ID is marked uncertain and requires reconciliation; it is not blindly resubmitted. There is no claim that a process-local timer or cache survives a Vercel restart. In-process rate limits remain best-effort across serverless instances; registration remains invite-gated and personal AI keys isolate provider usage.

## Judge access

Open the public website, register with the supplied invitation code, then choose EN/VI. In Settings, enter a Gemini or OpenAI API key and a model supported by that account. The key is held in the browser tab's session storage, sent through the backend for chat, and cleared on logout. WalPen does not store it in PostgreSQL or Walrus. Provider availability, account quotas and charges still apply.

An online provider receives the current message, supplied user history and selected approved memory excerpts. This is not local-only inference or end-to-end encryption. The relayer's existing plaintext processing also remains unchanged.

## DeepSurge acceptance evidence

The user's quoted requirements are the release criteria: a deployed chatbot must persist and recall context between conversations, adapt to individuals, and be used for a few real days before the article is finalized.

- Verify personalization with two separate accounts and different approved preferences. A new conversation should reflect only its account's relevant Walrus memory and show its sources.
- Record actual usage dates and changes in what the chatbot recalls across sessions. Backdated journal entries and the five-day fixture do not establish several days of real use.
- Keep example messages, source/blob references and user feedback only with the participant's permission. Redact personal content before publishing.
- The article remains a draft until real usage evidence is added. Existing technical tests and ten-blob evidence can be described with their original dates and limitations.
- If model choice changes from Ollama/Qwen to a cloud provider, update the submission's model/runtime and prize-track claims to match the actual judged deployment.

Source: [DeepSurge event](https://www.deepsurge.xyz/hackathons/c0141a4a-21be-4009-bc63-7c168608c849). Operational references: [Vercel Express](https://vercel.com/docs/frameworks/backend/express), [bounded background tasks](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil), [Neon integration](https://vercel.com/marketplace/neon).
