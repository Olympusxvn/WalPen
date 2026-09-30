# MemWal PR integration — 29 September 2026

## PR #605: token budgeting

Related history: [issue #277](https://github.com/MystenLabs/MemWal/issues/277), filed for Special One, requests serverless guidance on write timing, parallel recall and bounded prompt context. [Issue #592](https://github.com/MystenLabs/MemWal/issues/592) moves context-size budgeting into the SDK through token estimation and truncation. These are related concerns, not interchangeable fixes: a token cap does not enforce a network deadline or guarantee background-write completion. WalPen combines approved-excerpt token budgeting with durable write receipts and Vercel `waitUntil()`.

[PR #605](https://github.com/MystenLabs/MemWal/pull/605) is merged. WalPen's pinned SDK `@mysten-incubation/memwal@0.1.7` already exports `applyTokenBudget` and `estimateTokens`, so no package upgrade or vendored patch is needed.

WalPen now budgets the approved memory context to **768 estimated tokens**, including the serialized reference/date metadata, with at most five sources. It uses the SDK's `high-relevance-only` strategy: retain whole excerpts in recall order and drop the remaining tail when the next excerpt does not fit. Stored journal text is never shortened.

The order matters: parse the complete WalPen JSON envelope, validate user/active revision/consent/blob identity and the approved excerpt, then apply the budget. Budgeting raw JSON before validation could cut envelopes into invalid JSON or let revoked records consume the useful context window. The SDK helper is therefore used at the final authorized-context boundary rather than on the raw `recall()` envelope.

The chat API returns `memoryBudget` metadata. The bilingual UI explains when memories were omitted. The estimator is the SDK's character-based approximation, **not exact Qwen tokenization**. The 768-token limit covers only memory context, not the entire prompt, user message or conversation history.

## PR #885: deletion filtering

[PR #885](https://github.com/MystenLabs/MemWal/pull/885) is a relayer/PostgreSQL change, not a TypeScript client option. It excludes security-delete states `deleting`, `deleted` and `deleted_external` from recall candidates. It does not implement automatic superseding of application revisions or physically delete WalPen journals when consent is withdrawn.

On 29 September, the configured hosted relayer's `/version` endpoint reported build commit `94b7080b0ccae7e956e505f4b3af153d5846752c`. The [source at that commit](https://github.com/MystenLabs/MemWal/blob/94b7080b0ccae7e956e505f4b3af153d5846752c/services/server/src/storage/db.rs) contains the PR's exclusion query. Its activation depends on the relayer's security-delete schema/configuration; the public version response alone cannot prove that runtime condition. No production blob was deleted to probe it.

WalPen keeps its own persisted consent/revision filter. It now also rechecks every selected source after model generation: if a user withdraws consent or edits a memory while the model is answering, the API discards the obsolete answer and returns a localized retry message. A prompt already sent to Ollama cannot be unsent; this guard prevents returning the now-obsolete answer. No local journal cache is used to fill gaps when a blob is absent from relayer recall.

## Verification

Sixteen tests pass, including SDK whole-hit budgeting, Unicode excerpts, serialized-payload estimate metadata, source caps, permission filtering before budgeting, altered excerpt rejection, and withdrawal/edit races during model generation. TypeScript and the production build pass. The configured-secret scan passed for all 42 source files.

Production deployment `dpl_AXkCaD4GXckf9NWbtNmCAqtDpu18` is ready at https://walpen.vercel.app, serving frontend bundle `index-DCmFJ6QQ.js`. An authenticated fresh-chat check through that public URL correctly answered that fictional An walked in the park for 20 minutes on 15 September, citing the expected existing Walrus blob. It returned five approved sources and `memoryBudget: { maxTokens: 768, tokenEstimate: 201, truncated: true }`. The omission flag also covers the five-source cap. Observed latency was 79.5 seconds with local Ollama. No new memory was written for this verification. Private result: `data/evidence/pr-integration-live.json`.

The demo launcher now reads the live tunnel log with shared access and explicitly selects the Vercel project owner's scope, resolving two deployment startup failures encountered during this rollout.

## Submitted follow-ups

- [#1048 — durable recovery documentation](https://github.com/MystenLabs/MemWal/issues/1048).
- [#1049 — read-only receipt lookup by idempotency key](https://github.com/MystenLabs/MemWal/issues/1049).

The existing SDK already supports `remember(text, namespace, { idempotencyKey })` and `getRememberStatus(jobId)`. The feature ticket asks for lookup when only the persisted key is known, rather than requesting duplicate support for idempotent writes. WalPen's ambiguous-write handling remains conservative; this integration does not invent an unavailable receipt API or automatically replay older writes whose generated keys were not persisted.
