import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "../server/store.ts";
import { WalrusMemory } from "../server/memory.ts";
import {
  DEFAULT_RECALL_MAX_DISTANCE,
  emptyRecallDiagnostics,
  recallMaxDistance,
  selectRecallContext,
} from "../server/recall.ts";
import { recallNotices } from "../shared/recall.ts";
import { serializeMemories } from "../server/memory-context.ts";
import { recallPolicyFixtures } from "./fixtures/recall-policy.ts";
import historical from "./fixtures/recall-historical.json";

const entry = (id = "a", overrides: Partial<Entry> = {}): Entry => ({
  id,
  userId: "owner",
  rootId: id,
  revision: 1,
  supersedes: null,
  title: "Test",
  body: "PRIVATE JOURNAL",
  memory: "Approved fact",
  mood: "🌿",
  consent: true,
  occurredAt: "2026-10-03T00:00:00.000Z",
  createdAt: "2026-10-03T00:00:00.000Z",
  status: "synced",
  jobId: `job-${id}`,
  blobId: `blob-${id}`,
  error: null,
  retired: false,
  ...overrides,
});
const hit = (e: Entry, distance: unknown = 0.1) => ({
  blob_id: e.blobId!,
  text: JSON.stringify({ schema: "walpen/v1", ...e }),
  distance,
});

test("gateway preserves scores and response diagnostics without SDK prefiltering", async () => {
  const memory = new WalrusMemory();
  const response = {
    results: [hit(entry(), 0.7)],
    total: 19,
    dropped_count: 4,
  };
  let seen: unknown;
  memory.client = (() => ({
    recall: async (params: unknown) => {
      seen = params;
      return response;
    },
  })) as unknown as typeof memory.client;
  assert.deepEqual(await memory.recall("owner", "question"), response);
  assert.deepEqual(seen, { query: "question", limit: 20 });
});

test("default cutoff retains the historical expected hits while excluding distant candidates", () => {
  const summarize = (cutoff: number) => {
    let expectedCases = 0,
      kept = 0;
    for (const row of historical.cases) {
      const entries = row.matches.map((_, i) => entry(String(i)));
      const selected = selectRecallContext(
        { results: row.matches.map((m, i) => hit(entries[i], m.distance)) },
        entries,
        cutoff,
      );
      kept += selected.sources.length;
      if (selected.sources.some((s) => row.matches[Number(s.id)].expected))
        expectedCases++;
    }
    return { expectedCases, kept };
  };
  assert.deepEqual(summarize(0.5), { expectedCases: 0, kept: 0 });
  assert.deepEqual(summarize(DEFAULT_RECALL_MAX_DISTANCE), {
    expectedCases: 9,
    kept: 18,
  });
  assert.deepEqual(summarize(0.75), { expectedCases: 9, kept: 23 });
});

test("configuration validates cutoff, explicit off and provisional default", () => {
  assert.equal(recallMaxDistance(undefined), DEFAULT_RECALL_MAX_DISTANCE);
  assert.equal(recallMaxDistance(" "), 0.7);
  assert.equal(recallMaxDistance("0.35"), 0.35);
  assert.equal(recallMaxDistance("2"), 2);
  assert.equal(recallMaxDistance(" OFF "), null);
  for (const input of ["0", "-1", "NaN", "Infinity", "2.1", "oops"])
    assert.throws(() => recallMaxDistance(input), /MEMWAL_RECALL_MAX_DISTANCE/);
});

test("strict relevance boundary, invalid scores and duplicates have distinct counts", () => {
  const entries = [entry("a"), entry("b"), entry("c")];
  const results = [
    hit(entries[0], 0.49),
    hit(entries[0], 0.1),
    hit(entries[1], 0.5),
    hit(entries[2], 0.9),
    ...[undefined, null, "0.1", NaN, Infinity, -0.1, 2.1].map((d) => ({
      ...hit(entries[1]),
      distance: d,
    })),
  ];
  const selected = selectRecallContext(
    { results, total: 40, dropped_count: 3 },
    entries,
    0.5,
  );
  assert.deepEqual(
    selected.sources.map((s) => s.id),
    ["a"],
  );
  assert.equal(selected.diagnostics.returnedCount, 11);
  assert.equal(selected.diagnostics.duplicates, 1);
  assert.equal(selected.diagnostics.invalidDistance, 7);
  assert.equal(selected.diagnostics.relevanceRejected, 2);
  assert.equal(selected.diagnostics.upstreamTotal, 40);
  assert.equal(selected.diagnostics.upstreamDropped, 3);
  assert.equal(
    selectRecallContext({ results: [hit(entries[1], 0.8)] }, entries, null)
      .sources.length,
    1,
  );
  assert.equal(
    selectRecallContext(
      { results: [{ ...hit(entries[1]), distance: undefined }] },
      entries,
      null,
    ).sources.length,
    0,
  );
  assert.deepEqual(recallNotices(selected.diagnostics, "en"), [
    "The service reported results it could not download or decrypt; this search may be incomplete.",
  ]);
});

test("high relevance cannot bypass revisions, consent, ownership or exact-excerpt guards", () => {
  const current = entry();
  const withdrawn = entry("withdrawn", { consent: false });
  const retired = entry("old", { retired: true });
  const pending = entry("pending", { status: "pending" });
  const foreign = entry("foreign", { userId: "other" });
  const remote = [
    hit(withdrawn, 0),
    hit(retired, 0),
    hit(pending, 0),
    hit(foreign, 0),
    hit({ ...current, memory: "NOT APPROVED" }, 0),
    { ...hit(current, 0), text: "null" },
    { ...hit(current, 0), text: "{" },
    hit(current, 0.2),
  ];
  const selected = selectRecallContext(
    { results: remote },
    [current, withdrawn, retired, pending],
    0.5,
  );
  assert.deepEqual(
    selected.sources.map((s) => s.id),
    [current.id],
  );
  assert.equal(selected.diagnostics.authorizationRejected, 7);
  assert.ok(!JSON.stringify(selected).includes("PRIVATE JOURNAL"));
  assert.ok(!JSON.stringify(selected.diagnostics).includes("foreign"));
});

test("all-filtered, no-match and upstream-drop outcomes preserve uncertainty", () => {
  const e = entry();
  const filtered = selectRecallContext(
    { results: [hit(e, 0.8)], total: 1 },
    [e],
    0.5,
  );
  assert.equal(filtered.diagnostics.status, "empty");
  assert.deepEqual(filtered.diagnostics.reasons, ["relevance_rejected"]);
  const noMatch = selectRecallContext({ results: [] }, [e], 0.5);
  assert.equal(noMatch.diagnostics.upstreamTotal, null);
  assert.equal(noMatch.diagnostics.upstreamDropped, null);
  assert.deepEqual(noMatch.diagnostics.reasons, ["no_matches"]);
  const dropped = selectRecallContext(
    { results: [], dropped_count: 2, total: 2 },
    [e],
    0.5,
  );
  assert.deepEqual(dropped.diagnostics.reasons, ["upstream_dropped"]);
  for (const invalid of [-1, 0.2, NaN, Infinity, "3"]) {
    const d = selectRecallContext(
      { results: [], total: invalid, dropped_count: invalid },
      [],
      0.5,
    ).diagnostics;
    assert.equal(d.upstreamTotal, null);
    assert.equal(d.upstreamDropped, null);
  }
  for (const d of [
    noMatch.diagnostics,
    filtered.diagnostics,
    dropped.diagnostics,
  ]) {
    assert.match(
      recallNotices(d, "en")[0],
      /does not mean you have no saved memories/,
    );
    assert.match(recallNotices(d, "vi")[0], /không có nghĩa/);
  }
});

test("relevance precedes whole-excerpt budgeting and source references remain contiguous", () => {
  const entries = [
    entry("irrelevant", { memory: "x".repeat(2000) }),
    ...Array.from({ length: 7 }, (_, i) =>
      entry(String(i), { memory: `fact ${i}` }),
    ),
  ];
  const selected = selectRecallContext(
    { results: entries.map((e, i) => hit(e, i ? 0.1 : 0.9)) },
    entries,
    0.5,
  );
  assert.deepEqual(
    selected.sources.map((s) => s.text),
    ["fact 0", "fact 1", "fact 2", "fact 3", "fact 4"],
  );
  assert.deepEqual(
    JSON.parse(serializeMemories(selected.sources)).map(
      (s: { reference: number }) => s.reference,
    ),
    [1, 2, 3, 4, 5],
  );
  assert.equal(selected.diagnostics.budgetOmitted, 2);
  assert.equal(selected.diagnostics.relevanceRejected, 1);
  assert.ok(selected.meta.tokenEstimate <= 768);
  const huge = entry("huge", { memory: "あ".repeat(4000) });
  const empty = selectRecallContext({ results: [hit(huge)] }, [huge], 0.5);
  assert.deepEqual(empty.sources, []);
  assert.deepEqual(empty.diagnostics.reasons, ["budget_omitted"]);
});

test("EN/VI policy fixtures document overlapping scores and threshold tradeoffs", () => {
  for (const language of ["en", "vi"]) {
    const scores = [0.4, 0.5, 0.6, 0.7].map((max) => {
      let tp = 0,
        fp = 0,
        tn = 0,
        fn = 0;
      for (const f of recallPolicyFixtures.filter(
        (f) => f.language === language,
      )) {
        const e = entry("fixture", { memory: f.memory });
        const included =
          selectRecallContext({ results: [hit(e, f.distance)] }, [e], max)
            .sources.length > 0;
        if (included && f.relevant) tp++;
        else if (included) fp++;
        else if (f.relevant) fn++;
        else tn++;
      }
      return { tp, fp, tn, fn };
    });
    assert.deepEqual(
      scores,
      language === "en"
        ? [
            { tp: 2, fp: 0, tn: 3, fn: 1 },
            { tp: 2, fp: 1, tn: 2, fn: 1 },
            { tp: 3, fp: 1, tn: 2, fn: 0 },
            { tp: 3, fp: 2, tn: 1, fn: 0 },
          ]
        : [
            { tp: 1, fp: 0, tn: 3, fn: 2 },
            { tp: 2, fp: 1, tn: 2, fn: 1 },
            { tp: 3, fp: 1, tn: 2, fn: 0 },
            { tp: 3, fp: 2, tn: 1, fn: 0 },
          ],
    );
  }
});

test("disabled, unavailable and failure notices are localized without invented counts", () => {
  for (const status of ["disabled", "unavailable", "failed"] as const) {
    const d = emptyRecallDiagnostics(0.5, status);
    assert.equal(d.returnedCount, null);
    assert.equal(d.upstreamDropped, null);
    assert.notEqual(recallNotices(d, "en")[0], recallNotices(d, "vi")[0]);
  }
});
