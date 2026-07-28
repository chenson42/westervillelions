/**
 * Unit tests for the batch-reconciliation fan-out fix and new read helpers in
 * src/lib/reconciliation-queries.ts (docs/work-log/2026-07-28-zeffy-batch-reconciliation.md,
 * DECISION-051).
 *
 * Covers Phase 3 design's "Unit Tests to Write in Phase 4" items 1, 2, and 6:
 *   1. getTieOutAssembly counts a batched line once (the fan-out regression test).
 *   2. getBankLinesForSession returns matchedTransactionIds: string[].
 *   6. Per-row unmatch leaves the rest — feeds back into item 1's fixed
 *      getTieOutAssembly / item 2's fixed getBankLinesForSession by simulating
 *      the row set AFTER one match of a batch has been deleted (the DELETE
 *      route itself has no new logic to test — it's still a plain
 *      `delete().where(eq(id, matchId))`, unaffected by this feature; the
 *      observable effect of "leaves the rest" lives entirely in these two
 *      read queries re-aggregating correctly over N-1 remaining rows).
 *
 * Hermetic: mocks @/lib/db so `pnpm test` passes without DATABASE_URL/DB_URL
 * set — same FIFO-queue convention as financial-report-queries.test.ts /
 * ledger-queries.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      orderBy: () => obj,
      groupBy: () => obj,
      limit: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.queue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return { db: { select: () => chain() } };
});

import {
  getTieOutAssembly,
  getBankLinesForSession,
  getMatchedTransactionsForSession,
  type BankLineWithMatch,
} from "./reconciliation-queries";
import type { LedgerBankLine } from "./db/schema";

beforeEach(() => {
  mockDbState.queue = [];
});

function makeBankLine(overrides: Partial<LedgerBankLine> = {}): LedgerBankLine {
  return {
    id: "line-1",
    sessionId: "session-1",
    bankAccountId: "account-1",
    postingDate: "2026-06-29",
    description: "ZEFFY DEPOSIT",
    amountCents: 69_600,
    rawType: "ACH_CREDIT",
    checkOrSlipNumber: null,
    balanceCents: null,
    inStatementPeriod: true,
    dedupeKey: "dk-1",
    createdAt: new Date(),
    ...overrides,
  } as LedgerBankLine;
}

// ---------------------------------------------------------------------------
// getTieOutAssembly — Phase 3 test 1 (the fan-out regression test)
// ---------------------------------------------------------------------------

describe("getTieOutAssembly", () => {
  it("counts a batched line once — a bank line joined to 3 match rows (simulating the LEFT JOIN fan-out) contributes its amount to matchedLineAmountsCents exactly once, not 3x", async () => {
    mockDbState.queue.push([
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-a" },
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-b" },
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-c" },
    ]);

    const result = await getTieOutAssembly("session-1");

    expect(result.matchedLineAmountsCents).toEqual([69_600]);
    expect(result.matchedLineAmountsCents).toHaveLength(1);
    expect(result.unmatchedInPeriodBankLineIds).toEqual([]);
  });

  it("still separates matched from unmatched lines correctly alongside a batch (no cross-line contamination)", async () => {
    mockDbState.queue.push([
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-a" },
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-b" },
      { id: "line-2", amountCents: 5_000, matchedTransactionId: null },
    ]);

    const result = await getTieOutAssembly("session-1");

    expect(result.matchedLineAmountsCents).toEqual([69_600]);
    expect(result.unmatchedInPeriodBankLineIds).toEqual(["line-2"]);
  });

  it("(Phase 3 test 6 — per-row unmatch leaves the rest) after one match is deleted out of a 3-match batch, the line's amount still counts once and the tie-out reflects the remaining 2 matches, not zero", async () => {
    // Simulates the row set AFTER a DELETE of one matchId from the batch —
    // the DELETE route itself is unchanged (plain delete-by-id); this is the
    // read side re-aggregating correctly over the N-1 remaining rows.
    mockDbState.queue.push([
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-a" },
      { id: "line-1", amountCents: 69_600, matchedTransactionId: "txn-b" },
    ]);

    const result = await getTieOutAssembly("session-1");

    expect(result.matchedLineAmountsCents).toEqual([69_600]);
    expect(result.unmatchedInPeriodBankLineIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBankLinesForSession — Phase 3 test 2
// ---------------------------------------------------------------------------

describe("getBankLinesForSession", () => {
  it("returns matchedTransactionIds: string[] with ALL matched ids for a batched line, not just the last-joined one", async () => {
    const line = makeBankLine();
    mockDbState.queue.push([
      { line, matchedTransactionId: "txn-a" },
      { line, matchedTransactionId: "txn-b" },
      { line, matchedTransactionId: "txn-c" },
    ]);

    const result: BankLineWithMatch[] = await getBankLinesForSession("session-1");

    expect(result).toHaveLength(1);
    expect(result[0].matchedTransactionIds).toEqual(["txn-a", "txn-b", "txn-c"]);
  });

  it("returns an empty array for an unmatched line", async () => {
    const line = makeBankLine({ id: "line-2" });
    mockDbState.queue.push([{ line, matchedTransactionId: null }]);

    const result = await getBankLinesForSession("session-1");

    expect(result).toHaveLength(1);
    expect(result[0].matchedTransactionIds).toEqual([]);
  });

  it("preserves order and count of unrelated lines alongside a batched line", async () => {
    const batched = makeBankLine({ id: "line-1", postingDate: "2026-06-29" });
    const unrelatedA = makeBankLine({ id: "line-2", postingDate: "2026-06-30" });
    const unrelatedB = makeBankLine({ id: "line-3", postingDate: "2026-07-01" });
    mockDbState.queue.push([
      { line: batched, matchedTransactionId: "txn-a" },
      { line: batched, matchedTransactionId: "txn-b" },
      { line: unrelatedA, matchedTransactionId: null },
      { line: unrelatedB, matchedTransactionId: "txn-z" },
    ]);

    const result = await getBankLinesForSession("session-1");

    expect(result.map((l) => l.id)).toEqual(["line-1", "line-2", "line-3"]);
    expect(result[0].matchedTransactionIds).toEqual(["txn-a", "txn-b"]);
    expect(result[1].matchedTransactionIds).toEqual([]);
    expect(result[2].matchedTransactionIds).toEqual(["txn-z"]);
  });

  it("(Phase 3 test 6 — per-row unmatch leaves the rest) after removing one matchId from a 3-match batch, the remaining 2 transaction ids are still returned", async () => {
    const line = makeBankLine();
    mockDbState.queue.push([
      { line, matchedTransactionId: "txn-a" },
      { line, matchedTransactionId: "txn-b" },
    ]);

    const result = await getBankLinesForSession("session-1");

    expect(result[0].matchedTransactionIds).toEqual(["txn-a", "txn-b"]);
  });
});

// ---------------------------------------------------------------------------
// getMatchedTransactionsForSession — new helper (DECISION-051)
// ---------------------------------------------------------------------------

describe("getMatchedTransactionsForSession", () => {
  it("returns one row per match, carrying matchId + bankLineId alongside transaction detail — groupable client-side by bankLineId", async () => {
    mockDbState.queue.push([
      {
        matchId: "match-1",
        bankLineId: "line-1",
        id: "txn-a",
        txnDate: "2026-06-24",
        flow: "income",
        amountCents: 9_600,
        party: "Member A",
        memo: null,
        checkNumber: null,
        paymentMethod: "zeffy",
      },
      {
        matchId: "match-2",
        bankLineId: "line-1",
        id: "txn-b",
        txnDate: "2026-06-24",
        flow: "income",
        amountCents: 12_000,
        party: "Member B",
        memo: null,
        checkNumber: null,
        paymentMethod: "zeffy",
      },
    ]);

    const rows = await getMatchedTransactionsForSession("session-1");

    expect(rows).toHaveLength(2);
    const byLine = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byLine.get(r.bankLineId) ?? [];
      arr.push(r.matchId);
      byLine.set(r.bankLineId, arr);
    }
    expect(byLine.get("line-1")).toEqual(["match-1", "match-2"]);
  });
});
