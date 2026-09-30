# WalPen implementation status

Updated: 30 September 2026. Initial verification below dates from 19 September unless noted otherwise. This file distinguishes verified work from remaining competition tasks.

## Implemented

- React/TypeScript responsive journal, editor, consent panel, memories, chat and settings.
- English/Vietnamese interface with browser-persisted preference and localized dates. User content is never automatically translated.
- Account registration/login, salted scrypt passwords, HttpOnly/SameSite/Secure production sessions, origin validation and request limits.
- Encrypted SQLite cache, journal revision history, withdrawal filtering, export, consistent backup and restart recovery.
- MemWal 0.1.7 integration with per-user namespaces, asynchronous confirmation, uncertain-write reconciliation and no blind write retries.
- Local Ollama provider and request-scoped Gemini/OpenAI personal keys for cloud chat; language choice passed into generation.
- Vercel frontend and serverless API with Neon persistence, durable write receipts and bounded background synchronization.
- Sui wallet personal-message authentication, browser-bound expiring challenges, replay prevention and linking to existing password accounts without changing namespaces.

## Verified so far

- Ten fictional demonstration memories written to the supplied account on Walrus Mainnet, with ten distinct confirmed blob IDs. A new MemWal client retrieved relevant memories. Private evidence: `data/evidence/walrus-verification.json`.
- A separate journal page created through the browser was confirmed on Walrus.
- The public Vercel site authenticated the same demo user and opened that page through HTTPS.
- Desktop and 390px mobile layouts visually inspected.
- Production URL: https://walpen.vercel.app. VI/EN switching and reload persistence verified in the public browser, including mobile.
- Sixteen tests pass as of 29 September; TypeScript and production build pass. Configured-secret scan found no configured secrets in 42 source files.
- Synthetic semantic-recall evaluation found the expected blob in the top three results for 9/10 questions. This small fixture evaluation is not a general accuracy claim.
- Public fresh-chat comparison with local `qwen3:4b-instruct-2507-q4_K_M`: English with memory off returned no saved activity; Vietnamese with memory on correctly retrieved the riverside walk and cited its source. Initial observed latency was about 44 and 31 seconds on this CPU host.
- An encrypted SQLite snapshot was created under ignored `data/backups/`; recovery behavior is covered by integration tests.
- Unit/integration coverage includes cross-user access attempts, encrypted storage, absent/revoked consent, immutable revisions, job timeout handling, unavailable services, forged blob results and language dictionary coverage.

The Mainnet facts and browser demo are synthetic test data, not claims of real-user adoption.

## Operational constraints

Production no longer depends on the user's machine: Vercel hosts the API and Neon stores encrypted application data. The old local API and tunnel have been stopped. Judges and guests connect a Sui wallet, approve a sign-in message and supply the invitation code on first registration. Cloud chat needs a personal Gemini/OpenAI key in Settings. The local installer remains available for Ollama use.

The original `qwen3:4b` model produced incomplete reasoning in this setup. The demo uses the explicit instruct variant instead. Generation rejects truncated answers, and reference numbers without an actual returned source are removed. This does not guarantee all model claims are correct.

The user explicitly authorized transferring the competition delegate key and existing encryption key into Vercel server secrets. They are also retained in ignored local configuration, never in frontend code or Git. The database encryption key must be preserved to read existing cache/backups. The user plans to revoke the delegate after the event.

## Not yet complete

- Real-user feedback and evidence of actual use.
- Independent confirmation of the event's agent identifier and dedicated Sessions wallet.
- Published article, social promotion and final event submission.
- Complete recovery from Walrus alone and a successful cloud-provider answer with a valid personal AI key.

Update 29 September 2026: the observed five-day-test encryption incident was reported at https://github.com/MystenLabs/MemWal/issues/1047. No article, registration or final competition submission has been sent on the user's behalf.

The requested recovery documentation and receipt-lookup proposals were submitted as [#1048](https://github.com/MystenLabs/MemWal/issues/1048) and [#1049](https://github.com/MystenLabs/MemWal/issues/1049). The local Airtable draft includes them; the online form has not been submitted.

MemWal PR #605's SDK helper now bounds authorized memory context to 768 estimated tokens. PR #885's exclusion query is present in the hosted relayer's reported build; activation still depends on its runtime schema/configuration. WalPen additionally rejects obsolete answers after concurrent edits/withdrawal. The updated Vercel app passed a real read-only recall/chat check: correct park/20-minute answer, five sources, estimated memory cost 201 tokens, 79.5-second latency. See [integration details](MEMWAL-PR-INTEGRATION.md).

## Demo recovery — 30 September 2026

The public frontend returned HTTP 200, but `/api/health` returned HTTP 502. The local API was not listening and no Cloudflare tunnel process was running; Ollama remained available. The frontend's generic connection-interrupted message was the fallback for the non-JSON gateway response.

Restarted the API and tunnel with `scripts/start-demo.ps1 -Deploy`, updated the external rewrite and deployed `dpl_BjWXbQUA3z9AGw98uZjfTZAPsqwU`. Local, tunnel and public health checks then returned HTTP 200. The browser loaded six existing journal pages. A fresh authenticated chat recalled the expected park/20-minute fixture with its source, five approved excerpts and 201 estimated memory-context tokens in 75.5 seconds. No new memory was written for verification; evidence is stored locally at `data/evidence/demo-recovery-2026-09-30.json`.

This was the earlier availability/configuration recovery, before the cloud cutover below.

## Cloud cutover and wallet login — 30 September 2026

Migrated two users, fifteen active sessions and eleven revisions to Neon, preserving identities and encrypted records. Production deployment `dpl_3bT8EiTPc6GvvMg8Uy4rzv69DqHa` serves the public URL. Existing login and journal retrieval passed. A fictional cloud write received confirmed blob `QjRit8WOTkX-o0TQlUDOYEJtwgpDshkgaiTslc7P0zM`; health remained successful after stopping the local API and tunnel.

Twenty-seven local tests and one isolated live-Neon integration test passed. Edge verified the production Connect Wallet/signature flow with an unfunded synthetic wallet and retained the same account after reload. The test signed a real personal message; it did not exercise a user's installed wallet extension or establish real-user adoption. EN/VI personal-key settings passed mocked UI checks. Online-model generation with a valid key remains unverified. See [cloud operations](CLOUD-DEPLOYMENT.md) and [friend testing](FRIEND-TEST-GUIDE.vi.md).
