# Recall relevance and diagnostics

Implementation for [WalPen #1](https://github.com/Olympusxvn/WalPen/issues/1), 3 October 2026.

## Configuration and selection

`MEMWAL_RECALL_MAX_DISTANCE` is a server setting. The default is **0.7**, a provisional starting point informed by the historical fixture below. Valid numeric settings are greater than zero and at most two. `off` disables the relevance cutoff. Empty or absent configuration uses the default; invalid configuration stops application startup with a configuration error.

The current adapter requests the SDK's default semantic ranking, without composite weights. Lower cosine distance means a closer match. A hit passes only when `distance < threshold`, matching MemWal 0.1.7's strict `maxDistance` boundary. Missing, non-numeric, non-finite, negative or greater-than-two distances are rejected even with the threshold set to `off`. This deliberately favors excluding an unscored hit over claiming it is relevant.

The adapter preserves the returned hits, their distances, `total` and `dropped_count`. It does not pass `maxDistance` to the SDK: that SDK version rewrites `total` after filtering and would hide how many hits WalPen rejected. WalPen applies the equivalent comparison after validating the current user's approved revision, blob and exact excerpt. Duplicates are removed, then the existing five-source / 768-estimated-token budget is applied to whole excerpts in recall order. The post-generation consent/revision recheck remains in place.

The recovery endpoint still receives raw recall results when reconciling uncertain writes; a semantic question cutoff must not prevent a known receipt from being reconciled. No local journal text is substituted for a missing remote hit.

Set the variable in `.env` for manual local runs, `data/local/.env` for the local launcher, or the Vercel server environment for hosted runs. Restart/redeploy after changing it. It is not a frontend setting and cannot be changed through the chat request.

## API diagnostics

Successful chat responses include `recall`. Retrieval failures return HTTP 503 with a localized error and `recall.status = "failed"`; the model is not called.

| Field                                                | Meaning                                                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `status`                                             | `used`, `empty`, `disabled`, `unavailable` (unconfigured), or `failed`                                                            |
| `maxDistance`                                        | Configured strict upper bound; `null` means cutoff disabled                                                                       |
| `returnedCount`                                      | Number of hits received by WalPen; `null` if retrieval was not completed                                                          |
| `upstreamTotal`                                      | Valid nonnegative integer reported by the upstream response; never the namespace size                                             |
| `upstreamDropped`                                    | Valid nonnegative integer reported as download/decryption drops; missing or invalid metadata remains `null`, not an inferred zero |
| `authorizationRejected`                              | Hits failing current-revision, consent, blob or payload validation; includes malformed envelopes                                  |
| `invalidDistance`, `relevanceRejected`, `duplicates` | Counts rejected at those successive stages, without double counting a hit                                                         |
| `eligibleCount`, `budgetOmitted`, `usedCount`        | Counts before budgeting, omitted by the source/token cap, and passed to the model                                                 |
| `reasons`                                            | Observed exclusion reasons; several can coexist                                                                                   |

No raw payloads, entry IDs, wallet addresses, provider keys or exception details are added to diagnostics or logs. `returnedCount` is not a search-space total. An empty returned list with unknown drop metadata is described only as a search returning no memories. A reported drop warns of incomplete retrieval even if some sources remain usable.

EN/VI notices explain empty context without asserting that the user has never saved memories. They distinguish relevance filtering, invalid scores, current-approval validation, reported upstream drops and budget omission. The API exposes counts for diagnostics; the ordinary chat UI uses plain explanations. Missing upstream diagnostics do not produce invented certainty. The model prompt also distinguishes zero selected sources from zero stored memories.

## Offline EN/VI policy evaluation

The twelve [fixtures](../tests/fixtures/recall-policy.ts) contain six English and six Vietnamese query/excerpt pairs, with three relevant and three irrelevant pairs per language. **Distances are hand-authored test inputs, not embedding measurements.** This evaluation checks the selection policy and exposes overlapping scores; it does not calibrate the relayer or estimate production accuracy.

Run `npm test` to reproduce the assertions. Outcomes per language are:

| Strict cutoff                 | Language | Relevant kept | Irrelevant kept (false positive) | Irrelevant rejected | Relevant rejected (false negative) |
| ----------------------------- | -------- | ------------: | -------------------------------: | ------------------: | ---------------------------------: |
| 0.4                           | EN       |             2 |                                0 |                   3 |                                  1 |
| 0.4                           | VI       |             1 |                                0 |                   3 |                                  2 |
| 0.5                           | EN       |             2 |                                1 |                   2 |                                  1 |
| 0.5                           | VI       |             2 |                                1 |                   2 |                                  1 |
| 0.6                           | EN       |             3 |                                1 |                   2 |                                  0 |
| 0.6                           | VI       |             3 |                                1 |                   2 |                                  0 |
| **0.7 (provisional default)** | EN       |             3 |                                2 |                   1 |                                  0 |
| **0.7 (provisional default)** | VI       |             3 |                                2 |                   1 |                                  0 |

At 0.5, “I walk to the bank to pay bills” (0.42) is a false positive for “What helps me unwind?”, while “Ten minutes under the trees clears my head” (0.54) is a false negative. The Vietnamese examples similarly retain a riverside client meeting (0.46) and reject sitting under trees to clear one's head (0.58). These deliberately overlapping scores show why authorization and a distance threshold alone cannot guarantee semantic relevance.

At the selected 0.7 default, the false positives additionally include cooking queries paired with cycling preferences (EN 0.61 / VI 0.65), while no relevant pair is rejected in this small constructed set. This is not evidence of zero false negatives in real use.

## Historical distance check and default choice

A saved evaluation from **19 September 2026, 05:46 UTC** contains ten Vietnamese questions against fictional memories, with three returned matches each. The expected blob appeared in nine of ten top-three lists. A [sanitized score fixture](../tests/fixtures/recall-historical.json) preserves only distances and expected-match flags from that record, with no blob IDs, journal text or account identifiers. The original local record is `data/evidence/recall-evaluation.json`; the tracked fixture allows the policy check to be reproduced without it.

| Cutoff                                | Questions retaining their expected match | Returned candidates retained |
| ------------------------------------- | ---------------------------------------: | ---------------------------: |
| No cutoff (original top-three output) |                                     9/10 |                        30/30 |
| 0.5                                   |                                     0/10 |                         0/30 |
| **0.7**                               |                                 **9/10** |                    **18/30** |
| 0.75                                  |                                     9/10 |                        23/30 |
| 0.8                                   |                                     9/10 |                        30/30 |

The expected-hit distances range from approximately 0.504 to 0.693. A default of 0.5 would have removed all previously found expected hits; 0.7 preserves them while excluding twelve more distant candidates. The question whose expected blob was absent remains unresolved. Non-target candidates have not all been independently labeled irrelevant, so the twelve exclusions are not claimed as twelve corrected false positives. This historical result used top-three recall, not today's twenty-candidate chat pipeline, and is not a fresh Mainnet test or evidence from real-user journals.

The default is provisional: collect consented EN/VI query/excerpt labels and actual distances from the current deployed relayer, split tuning and held-out cases, and compare false positives/negatives by language. Changing embedding models, language mix or memory envelopes requires reevaluation. This change made no Mainnet writes or new live embedding calls.

## Verification scope

Verified on 3 October 2026: 31 application/SDK regression tests and eight local-setup tests passed, TypeScript and the production build passed, and the configured-secret scan passed. The built UI check passed in headless Edge with mocked responses. The additional reconciliation regression confirms that the chat threshold cannot hide a receipt during uncertain-write recovery. No live provider or new Mainnet retrieval was used for this verification.

The built UI is checked separately with `node tests/ui/recall.mjs` after `npm run build`. It runs headless Edge by default (override `WALPEN_TEST_BROWSER` for another installed Playwright browser channel), mocks the API and blocks external requests. It checks EN/VI notices, language switching, absent source cards and a retrieval error. Screenshots stay in ignored `data/recall-ui/`.

Regression coverage includes adapter metadata preservation, threshold configuration, strict equality at the cutoff, all-filtered and no-match outcomes, upstream drops, absent/invalid metadata, missing/invalid scores, duplicates, cross-user results, withdrawn/superseded/tampered excerpts, source numbering, whole-excerpt budgets, localized failures and consent/edit races during generation. The local launcher preserves its configured threshold independently of inherited cloud settings.

Native metadata filtering before top-k remains upstream work in [#434](https://github.com/MystenLabs/MemWal/issues/434) and [#292](https://github.com/MystenLabs/MemWal/issues/292). This implementation cannot recover a relevant match outside the returned twenty candidates.
