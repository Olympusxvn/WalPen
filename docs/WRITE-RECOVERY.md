# Recovering MemWal writes

Implemented for [WalPen #2](https://github.com/Olympusxvn/WalPen/issues/2), 3 October 2026. These are application guarantees and deterministic test results, not a claim of exactly-once Mainnet processing.

## What is persisted

Before calling MemWal, WalPen commits one opaque UUID key and an encrypted, frozen write intent for the journal revision. The intent contains the exact serialized text, account, relayer URL and namespace. The `write_intents` table also holds the attempt count, original start time, retry deadline inputs and a submission lease. No private key is copied into the intent. These internal fields are absent from journal API responses and exports.

SQLite uses `BEGIN IMMEDIATE`; Neon uses an entry-row lock inside a transaction. A failed intent commit prevents the network call. Each new revision receives a different key; retries retain the original key and exact payload. Changed payloads or destinations require reconciliation instead of silently reusing the key.

Once accepted, the job ID is saved before polling. Once completed, the blob receipt is saved. A later timeout or failure cannot replace a confirmed receipt. Lease tokens prevent an expired submitter from overwriting a newer attempt. The process-local lock and Vercel `waitUntil()` are optimizations; database state provides coordination and recovery.

## Retry policy

`MEMWAL_IDEMPOTENCY_RETRY_WINDOW_MS` defaults to **0**: uncertain submissions are retained and not replayed automatically. This does not disable caller-supplied idempotency keys or polling a known job.

Only set a positive window after verifying the selected relayer's deployed deduplication implementation, owner/key scope, payload-conflict behavior, retention period and deletion behavior. The value is milliseconds from the **first persisted attempt**, not from each retry. The parser accepts integers from 0 to 86400000; that upper bound is an application limit, not a MemWal retention guarantee. A useful enabled window must exceed the ten-minute submission lease, and must leave a safety margin inside the verified server retention period.

All submissions, including the first, count toward a maximum of three attempts. A live lease prevents another instance from submitting. The lease lasts ten minutes; the additional backoff is 30 seconds per attempt, and both gates must expire. Replay stops when the original window expires, the attempt budget is used, the destination/payload changes, or the revision is retired. The deadline is checked again before sending. Do not enable replay where a delayed request could arrive after server deduplication expires.

Configure the setting in `data/local/.env` for the local installer, `.env` for manual local runs, or server environment variables for Vercel. Restart/redeploy after a change. The local installer never inherits the production retry setting.

| Durable state | Recovery |
| --- | --- |
| Queued, never submitted, no key | Commit a new intent and submit once. |
| Key persisted, no job ID | Wait for the lease. Replay the same intent only inside an explicitly enabled, verified window. Otherwise retain uncertainty. |
| Job ID present | Poll that job; never submit a replacement. This remains valid for a retired revision already accepted remotely. |
| Confirmed blob | Keep the receipt; late failures cannot downgrade it. |
| Legacy submitting/uncertain, no key | Preserve uncertainty. Do not manufacture a key and replay. |
| Retired revision, no job ID | Do not send it during recovery, even if it has an old key. |
| Failed job | Retain the failure and existing identifiers for investigation. No automatic resubmission. |

On Vercel, later journal requests resume eligible work; Neon does not run a scheduler. Locally, startup and the existing periodic resume loop do so. **Check storage** polls known jobs or resumes eligible same-key attempts. Otherwise it uses the existing raw recall reconciliation path; lack of a recall match does not prove the write failed.

Withdrawing chat-memory approval creates a new non-approved revision under WalPen's existing journal-storage behavior. It retires the earlier revision; it does not erase a request already in flight or physically delete the old blob. The new revision can be stored once with its own key. Consent/revision guards continue to exclude withdrawn content from chat.

## Upstream evidence and limits

Reviewed MemWal source at [`1e0235856b3fffbe903596f34e1f5c89f27cba59`](https://github.com/MystenLabs/MemWal/tree/1e0235856b3fffbe903596f34e1f5c89f27cba59):

- [`remember.rs`](https://github.com/MystenLabs/MemWal/blob/1e0235856b3fffbe903596f34e1f5c89f27cba59/services/server/src/routes/remember.rs) looks up `(owner, idempotency_key)`, fingerprints text plus namespace, returns HTTP 409 for conflicting known fingerprints, and coordinates insertion through a unique index. Legacy null fingerprints have weaker conflict detection.
- [`013_remember_write_idempotency_index.sql`](https://github.com/MystenLabs/MemWal/blob/1e0235856b3fffbe903596f34e1f5c89f27cba59/services/server/migrations/013_remember_write_idempotency_index.sql) defines the owner/key uniqueness constraint. WalPen passes its key through SDK 0.1.7's `remember(text, namespace, { idempotencyKey })`.
- [`db.rs`](https://github.com/MystenLabs/MemWal/blob/1e0235856b3fffbe903596f34e1f5c89f27cba59/services/server/src/storage/db.rs) clears idempotency keys when forgetting a namespace. Keys are therefore not an unconditional lifetime guarantee. External deletion/forget operations must be coordinated with disabling pending replay; WalPen cannot detect a separate client's deletion.

The public relayer's `/version` response returned `build: {}` during this review. It did not establish its deployed source revision or a minimum retention guarantee. **Automatic ambiguous replay remains off by default.** Source inspection alone cannot establish the public deployment's behavior.

This implementation does not depend on a hypothetical receipt-by-key endpoint. It uses only existing same-key submission and job polling. [MemWal #1049](https://github.com/MystenLabs/MemWal/issues/1049) still tracks read-only receipt lookup; [#1048](https://github.com/MystenLabs/MemWal/issues/1048) tracks recovery guidance.

## Migration and backup

Startup adds `write_intents` without altering journal payloads. Legacy completed records retain receipts; known jobs remain pollable; legacy ambiguous writes are never assigned a new key for replay. Opening a second SQLite connection does not invalidate a live keyed lease.

SQLite snapshots include the entire intent table. Neon backups/exports must include it too. Keep the original encryption key separately. The SQLite-to-Neon migration copies frozen intents, keys, attempts and original timestamps; it supports older snapshots without that table and still refuses a populated destination. Stop the source service before cutover and prevent both deployments from operating independently after restoring/copying their databases. Restoring an old snapshot does not extend the upstream retention window.

## Verification

- `npm test`: offline regression tests, including a deterministic relayer fake that deduplicates by owner/key and rejects conflicting payloads. Tests assert logical stored-memory counts, not just HTTP-call counts.
- `npm run test:cloud` with `WALPEN_TEST_DATABASE_URL`: the same recovery scenarios run against two real PostgreSQL repositories in a temporary schema, removed afterward. This was run against Neon on 3 October 2026. The relayer remains fake.
- Covered: transaction failure before send, crash after intent commit, accepted response loss, database outage before saving the job ID, known-job polling after restart, concurrent instances, fencing, late failures, different users/revisions, payload/destination conflicts, disabled/expired/exhausted retries, legacy migration, retired revisions and encrypted snapshot recovery.

No Mainnet writes, paid fault injection, live forced Vercel restart, or real-user data were used for these recovery tests.
