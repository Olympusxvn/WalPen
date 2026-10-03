# WalPen issues and MemWal contributions

Last reviewed: **3 October 2026**. Statuses below are a dated snapshot; the linked GitHub threads are authoritative.

This record separates WalPen's application backlog, earlier upstream contributions adopted by the project, and new Session 8 feedback. A proposal or open issue does not mean the feature has shipped.

## WalPen recall improvement

**[WalPen #1 — Configurable recall relevance filtering and retrieval diagnostics](https://github.com/Olympusxvn/WalPen/issues/1)** · Implemented · `enhancement`

The adapter preserves distances and response diagnostics for twenty returned candidates. After validating the current user's approved revision, blob identity and exact excerpt, WalPen applies a configurable strict cosine-distance cutoff, removes duplicate hits, and budgets complete excerpts. The post-generation consent/revision recheck remains enforced.

`MEMWAL_RECALL_MAX_DISTANCE` defaults to **0.7**, informed by historical distances for fictional Vietnamese memories; it remains provisional. The implementation follows the SDK's `maxDistance` comparison at the application boundary so the SDK cannot overwrite the original total before diagnostics are captured. Missing or invalid scores fail closed. EN/VI notices distinguish empty context from an absence of saved memories.

See [configuration, diagnostics and evaluation](docs/RECALL-EVALUATION.md) for reproducible offline EN/VI fixtures, historical score comparisons, false-positive/false-negative examples and limits. This is an application implementation; no new Mainnet writes or upstream fixes are claimed.

Relevance filtering cannot recover an eligible memory outside the returned top-k. Native metadata filtering is tracked upstream in [#434](https://github.com/MystenLabs/MemWal/issues/434) and [#292](https://github.com/MystenLabs/MemWal/issues/292); [#1066](https://github.com/MystenLabs/MemWal/issues/1066) concerns information lost after distance filtering. These are related work, not additional WalPen reports.

## Evidence added to existing upstream discussions

One follow-up comment was published to each thread on 3 October 2026.

| Thread                                                                                     | Status                                                                  | WalPen evidence and direct comment                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#434 — Native metadata and memory types](https://github.com/MystenLabs/MemWal/issues/434) | Open                                                                    | [Comment](https://github.com/MystenLabs/MemWal/issues/434#issuecomment-5965025467): JSON revision/consent fields, validation after top-k, and the case for metadata predicates before selection. Includes code references and lifecycle/privacy requirements.                                                     |
| [#277 — Serverless latency guide](https://github.com/MystenLabs/MemWal/issues/277)         | Open                                                                    | [Comment](https://github.com/MystenLabs/MemWal/issues/277#issuecomment-5965035159): Vercel `waitUntil()`, conditional database claims, job IDs and receipts in Neon, request-driven recovery, and the remaining ambiguous-write window. Connects #1048, #1049 and #592 without conflating time and token budgets. |
| [#592 — Token budgeting](https://github.com/MystenLabs/MemWal/issues/592)                  | Closed; [PR #605](https://github.com/MystenLabs/MemWal/pull/605) merged | [Comment](https://github.com/MystenLabs/MemWal/issues/592#issuecomment-5965045306): deployed adoption of SDK helpers after authorization, five complete sources / 768 estimated memory tokens, tests and the dated live verification. No reopening requested.                                                     |

## Earlier core contributions adopted by WalPen

These issues originated in **Session 7**. They are prior contributions and integration evidence, rather than new Session 8 reports. The linked PRs are upstream implementations; reporting an issue does not imply authorship of its fix.

- **[#591](https://github.com/MystenLabs/MemWal/issues/591) → [PR #885](https://github.com/MystenLabs/MemWal/pull/885):** the discussion distinguished asynchronous write timing from deletion-related recall behavior. PR #885 merged on 25 September and addresses the narrower server-side exclusion of memories claimed for deletion. Issue #591 remains open. WalPen keeps its own active-revision and consent checks, including a recheck after model generation. The hosted relayer's reported source revision contains the exclusion query, but that alone does not prove the runtime security-delete configuration. No production blob was deleted to test it.
- **[#592](https://github.com/MystenLabs/MemWal/issues/592) → [PR #605](https://github.com/MystenLabs/MemWal/pull/605):** the token-budget request led to SDK functionality that WalPen uses through `applyTokenBudget` and `estimateTokens` in MemWal 0.1.7. PR #605 merged on 18 August and closed #592. WalPen preserves whole approved excerpts and accounts for serialized reference/date metadata. Its use of candidate indices preserves recall order rather than introducing new semantic ranking.

Implementation details and original verification: [MemWal PR integration](docs/MEMWAL-PR-INTEGRATION.md).

## Session 8 reports under observation

All three issues were **open**, with only the automated acknowledgment and no human reply, when checked on 3 October 2026.

| Issue                                                                                         | Scope                                                                                                                                          | Next useful update                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [#1047 — Encryption backend unavailable](https://github.com/MystenLabs/MemWal/issues/1047)    | Reports three of five accepted remember jobs failing in the 19 September run. Job acceptance and successful persistence are separate outcomes. | Maintainer diagnosis, mitigation, or a linked fix for the reported failures.                              |
| [#1048 — Durable recovery recipe](https://github.com/MystenLabs/MemWal/issues/1048)           | Documentation for timeouts/restarts, persisted job state and uncertain outcomes.                                                               | Recovery guidance or an example that distinguishes polling an accepted job from submitting another write. |
| [#1049 — Receipt lookup by idempotency key](https://github.com/MystenLabs/MemWal/issues/1049) | Read-only receipt lookup when the caller retains a key but loses the job-ID response.                                                          | An API proposal or implementation covering missing, pending, completed and failed receipts.               |

The SDK already supports caller-supplied idempotency keys and job-ID status lookup. #1049 requests the missing lookup path; it is not a request to add idempotent writes again. WalPen's current adapter does not persist/pass its own idempotency key and retains an uncertain state when it cannot establish the result.

A Codex follow-up is configured for **09:00 daily, Asia/Bangkok (UTC+7)**. It checks these three threads and linked fixes, reports meaningful changes, and stays quiet for unchanged state or routine bot acknowledgments. It does not post replies or change this repository automatically. The last-seen state is kept locally outside version control; this document remains a dated record.

## Evidence boundaries

- **Code-derived:** the rank-21 example in #434 illustrates the current selection order. It is not a newly reproduced Mainnet failure.
- **Historical functional check, 29 September:** a fresh conversation returned five approved sources and an estimated memory cost of 201 tokens within the 768-token cap, using fictional journal memories and local Ollama. This does not establish multilingual quality or several days of real-user adoption.
- **Cloud verification, 30 September:** the deployment record contains 27 local regression tests, one real Neon integration test in an isolated schema, and a confirmed Walrus write through the cloud API. It does not claim a live forced-restart benchmark or exactly-once processing.
- **Recovery limitation:** `waitUntil()` is bounded by the function runtime. Neon preserves state; it does not itself run a recovery worker. Pending work is resumed by subsequent journal requests, and unknown submissions are not blindly replayed.
- **Budget limitation:** token estimates are character-based and cover the memory section, not the entire prompt, history or network latency.

Supporting records: [cloud deployment](docs/CLOUD-DEPLOYMENT.md), [encryption incident](docs/MEMWAL-ENCRYPTION-INCIDENT.md), [recovery documentation ticket](docs/MEMWAL-RECOVERY-DOCS-TICKET.md), and [receipt lookup ticket](docs/MEMWAL-RECEIPT-LOOKUP-TICKET.md).
