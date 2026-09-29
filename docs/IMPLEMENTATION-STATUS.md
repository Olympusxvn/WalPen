# WalPen implementation status

Updated: 29 September 2026. Initial verification below dates from 19 September unless noted otherwise. This file distinguishes verified work from remaining competition tasks.

## Implemented

- React/TypeScript responsive journal, editor, consent panel, memories, chat and settings.
- English/Vietnamese interface with browser-persisted preference and localized dates. User content is never automatically translated.
- Account registration/login, salted scrypt passwords, HttpOnly/SameSite/Secure production sessions, origin validation and request limits.
- Encrypted SQLite cache, journal revision history, withdrawal filtering, export, consistent backup and restart recovery.
- MemWal 0.1.7 integration with per-user namespaces, asynchronous confirmation, uncertain-write reconciliation and no blind write retries.
- Local Ollama provider; language choice passed into generation.
- Vercel static frontend with an external API rewrite to the local backend's temporary Cloudflare tunnel.

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

Ollama, the API, encrypted SQLite database and Cloudflare tunnel live on the user's machine. The Vercel page remains online when the machine sleeps, but its API/chat will be unavailable. Restarting a Quick Tunnel changes its URL and requires updating the rewrite and redeploying. Use `scripts/start-demo.ps1 -Deploy` after checking Ollama and the environment configuration.

The original `qwen3:4b` model produced incomplete reasoning in this setup. The demo uses the explicit instruct variant instead. Generation rejects truncated answers, and reference numbers without an actual returned source are removed. This does not guarantee all model claims are correct.

The user explicitly authorized using the provided competition-only delegate key and plans to revoke it after the event. It is held only in ignored local `.env`, never in frontend code or Git. The database encryption key must be preserved to read existing cache/backups.

## Not yet complete

- Real-user feedback and evidence of actual use.
- Independent confirmation of the event's agent identifier and dedicated Sessions wallet.
- Published article, social promotion and final event submission.
- Permanent backend hosting and complete recovery from Walrus alone.

Update 29 September 2026: the observed five-day-test encryption incident was reported at https://github.com/MystenLabs/MemWal/issues/1047. No article, registration or final competition submission has been sent on the user's behalf.

The requested recovery documentation and receipt-lookup proposals were submitted as [#1048](https://github.com/MystenLabs/MemWal/issues/1048) and [#1049](https://github.com/MystenLabs/MemWal/issues/1049). The local Airtable draft includes them; the online form has not been submitted.

MemWal PR #605's SDK helper now bounds authorized memory context to 768 estimated tokens. PR #885's exclusion query is present in the hosted relayer's reported build; activation still depends on its runtime schema/configuration. WalPen additionally rejects obsolete answers after concurrent edits/withdrawal. The updated Vercel app passed a real read-only recall/chat check: correct park/20-minute answer, five sources, estimated memory cost 201 tokens, 79.5-second latency. See [integration details](MEMWAL-PR-INTEGRATION.md).
