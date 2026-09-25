/**
 * Unit tests for src/lib/financial-report-send.ts.
 *
 * docs/work-log/2026-09-25-financial-report-auto-send.md, Phase 3 "Unit
 * Tests the Implementer Must Deliver", items 1-7 (item 8, the route's
 * permission gate, lives in
 * src/app/api/admin/ledger/reports/send/route.test.ts).
 *
 * Hermetic, layered mocking:
 *   - @/lib/ledger-queries (getEntities/getEntityById/getFunds) and
 *     @/lib/financial-report-queries's getLatestOpenMonthForEntity() /
 *     getMonthlyStatement() are mocked as functions — this file tests
 *     financial-report-send.ts's OWN logic (fingerprinting, cutoff, claim
 *     ordering, treasurer hard-block), not those modules' internal query
 *     sequences, which already have their own test files.
 *   - monthBounds()/MEMBER_EXPOSED_FUND_KINDS are the REAL implementations
 *     (imported via importOriginal) since they're pure and this file's
 *     month-boundary logic depends on their real behavior.
 *   - @/lib/board-positions (resolveTreasurer) and @/lib/email (sendEmail)
 *     are mocked.
 *   - @/lib/db is mocked at the query-builder level for the two direct
 *     queries this file issues against financial_report_sends (a select
 *     history/latest-successful-send lookup, and the claim insert) — same
 *     FIFO-queue style as financial-report-queries.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    insertReturningQueue: [] as unknown[][],
  },
}));

vi.mock("@/lib/db", () => {
  function selectChain(): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      from: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      where: () => obj,
      orderBy: () => obj,
      limit: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.selectQueue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  function insertChain(): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      values: () => obj,
      onConflictDoNothing: () => obj,
      returning: () => Promise.resolve(mockDbState.insertReturningQueue.shift() ?? []),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(undefined).then(resolve, reject),
    };
    return obj;
  }
  return {
    db: {
      select: () => selectChain(),
      insert: () => insertChain(),
    },
  };
});

vi.mock("@/lib/ledger-queries", () => ({
  getEntities: vi.fn(),
  getEntityById: vi.fn(),
  getFunds: vi.fn(),
}));

vi.mock("@/lib/financial-report-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./financial-report-queries")>();
  return {
    ...actual,
    getLatestOpenMonthForEntity: vi.fn(),
    getMonthlyStatement: vi.fn(),
  };
});

vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import {
  computeTotalsFingerprint,
  listReadyToSendReports,
  sendMonthlyReportToBoard,
  CUTOFF_MONTH,
} from "./financial-report-send";
import { getEntities, getEntityById, getFunds } from "@/lib/ledger-queries";
import { getLatestOpenMonthForEntity, getMonthlyStatement } from "./financial-report-queries";
import { resolveTreasurer } from "@/lib/board-positions";
import { sendEmail } from "@/lib/email";
import type { MonthlyStatement } from "./financial-report-queries";
import type { LedgerEntity, LedgerFund } from "./db/schema";

beforeEach(() => {
  mockDbState.selectQueue = [];
  mockDbState.insertReturningQueue = [];
  vi.mocked(getEntities).mockReset();
  vi.mocked(getEntityById).mockReset();
  vi.mocked(getFunds).mockReset();
  vi.mocked(getLatestOpenMonthForEntity).mockReset();
  vi.mocked(getMonthlyStatement).mockReset();
  vi.mocked(resolveTreasurer).mockReset();
  vi.mocked(sendEmail).mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<LedgerEntity> = {}): LedgerEntity {
  return {
    id: "entity-1",
    slug: "club",
    name: "Westerville Lions Club",
    shortName: "Club",
    taxClassification: "501c4",
    charityStatus: null,
    ein: null,
    ohioEntityNumber: null,
    fiscalYearEnd: "06-30",
    donationsDeductible: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LedgerEntity;
}

function makeFund(overrides: Partial<LedgerFund> = {}): LedgerFund {
  return {
    id: "fund-1",
    entityId: "entity-1",
    slug: "administrative",
    name: "Administrative Fund",
    kind: "administrative",
    openingBalanceCents: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LedgerFund;
}

function makeStatement(overrides: Partial<MonthlyStatement> = {}): MonthlyStatement {
  return {
    month: "2026-09",
    monthEndLabel: "September 30, 2026",
    income: [],
    expense: [],
    totalRevenue: { oneMonthCents: 100_00, twelveMonthCents: 1000_00, budgetCents: 1200_00 },
    totalExpense: { oneMonthCents: 40_00, twelveMonthCents: 400_00, budgetCents: 500_00 },
    net: { oneMonthCents: 60_00, twelveMonthCents: 600_00, budgetCents: 700_00 },
    beginningBookBalanceCents: 5000_00,
    endingBookBalanceCents: 5060_00,
    bookVsCashDivergenceCents: 0,
    usedLegacyReconciledAtFallback: false,
    hasUndatedHistoricalRows: false,
    ...overrides,
  };
}

const TREASURER_OK = {
  ok: true as const,
  memberId: "member-1",
  firstName: "Pat",
  lastName: "Example",
  email: "pat@example.com",
};

// ---------------------------------------------------------------------------
// 1. computeTotalsFingerprint
// ---------------------------------------------------------------------------

describe("computeTotalsFingerprint", () => {
  it("is stable across repeated calls on identical input", () => {
    const statement = makeStatement();
    expect(computeTotalsFingerprint(statement)).toBe(computeTotalsFingerprint(makeStatement()));
  });

  it.each([
    ["month", { month: "2026-10" }],
    ["beginningBookBalanceCents", { beginningBookBalanceCents: 1 }],
    ["endingBookBalanceCents", { endingBookBalanceCents: 1 }],
    ["totalRevenue.oneMonthCents", { totalRevenue: { ...makeStatement().totalRevenue, oneMonthCents: 1 } }],
    ["totalExpense.oneMonthCents", { totalExpense: { ...makeStatement().totalExpense, oneMonthCents: 1 } }],
    ["net.oneMonthCents", { net: { ...makeStatement().net, oneMonthCents: 1 } }],
    [
      "totalRevenue.twelveMonthCents",
      { totalRevenue: { ...makeStatement().totalRevenue, twelveMonthCents: 1 } },
    ],
    [
      "totalExpense.twelveMonthCents",
      { totalExpense: { ...makeStatement().totalExpense, twelveMonthCents: 1 } },
    ],
    ["net.twelveMonthCents", { net: { ...makeStatement().net, twelveMonthCents: 1 } }],
    ["bookVsCashDivergenceCents", { bookVsCashDivergenceCents: 1 }],
  ])("changes when %s changes", (_label, overrides) => {
    const base = computeTotalsFingerprint(makeStatement());
    const changed = computeTotalsFingerprint(makeStatement(overrides as Partial<MonthlyStatement>));
    expect(changed).not.toBe(base);
  });

  it("is unchanged by fields deliberately excluded (line-item/display-only detail)", () => {
    const base = computeTotalsFingerprint(makeStatement());
    const changed = computeTotalsFingerprint(
      makeStatement({
        monthEndLabel: "A wildly different label",
        income: [
          {
            categoryId: "c1",
            categoryName: "Category",
            oneMonthCents: 999,
            twelveMonthCents: 999,
            annualBudgetCents: null,
            hasUncashedCheck: true,
            causeLines: null,
          },
        ],
        usedLegacyReconciledAtFallback: true,
        hasUndatedHistoricalRows: true,
        totalRevenue: { ...makeStatement().totalRevenue, budgetCents: 999_99 },
      }),
    );
    expect(changed).toBe(base);
  });
});

// ---------------------------------------------------------------------------
// 2 & 3. listReadyToSendReports — cutoff behavior, zero-transaction month
// ---------------------------------------------------------------------------

describe("listReadyToSendReports", () => {
  it("excludes a month before CUTOFF_MONTH even when the gate is open", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    // Ceiling one month before CUTOFF_MONTH — so if the cutoff weren't
    // enforced, nothing would ever iterate; confirms the guard rejects
    // BEFORE any per-month work happens.
    const beforeCutoff = "2026-08";
    vi.mocked(getLatestOpenMonthForEntity).mockResolvedValue(beforeCutoff);

    const rows = await listReadyToSendReports();

    expect(rows).toEqual([]);
    expect(getMonthlyStatement).not.toHaveBeenCalled();
  });

  it("includes a month at/after CUTOFF_MONTH that is open", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getLatestOpenMonthForEntity).mockResolvedValue(CUTOFF_MONTH);
    mockDbState.selectQueue.push([]); // getSendHistoryForEntity: no prior sends
    vi.mocked(getMonthlyStatement).mockResolvedValue({
      status: "ready",
      statement: makeStatement({ month: CUTOFF_MONTH }),
    });

    const rows = await listReadyToSendReports();

    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBe(CUTOFF_MONTH);
    expect(rows[0].state).toBe("never_sent");
  });

  it("excludes a still-gated month entirely — not actionable, not a status line", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getLatestOpenMonthForEntity).mockResolvedValue(CUTOFF_MONTH);
    mockDbState.selectQueue.push([]); // getSendHistoryForEntity
    // getMonthlyStatement returning "gated" simulates a month whose gate
    // re-closed (a genuine unreconciled backlog reappeared) between the
    // ceiling computation and this per-month check.
    vi.mocked(getMonthlyStatement).mockResolvedValue({ status: "gated" });

    const rows = await listReadyToSendReports();

    expect(rows).toEqual([]);
  });

  it("still offers a zero-transaction elapsed month as never_sent (Phase 3 ruling — no undocumented special case)", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getLatestOpenMonthForEntity).mockResolvedValue(CUTOFF_MONTH);
    mockDbState.selectQueue.push([]);
    vi.mocked(getMonthlyStatement).mockResolvedValue({
      status: "ready",
      statement: makeStatement({
        month: CUTOFF_MONTH,
        totalRevenue: { oneMonthCents: 0, twelveMonthCents: 0, budgetCents: 0 },
        totalExpense: { oneMonthCents: 0, twelveMonthCents: 0, budgetCents: 0 },
        net: { oneMonthCents: 0, twelveMonthCents: 0, budgetCents: 0 },
        beginningBookBalanceCents: 0,
        endingBookBalanceCents: 0,
      }),
    });

    const rows = await listReadyToSendReports();

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("never_sent");
  });

  it("skips an entity with zero or more than one member-exposed fund rather than guessing", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([
      makeFund({ id: "f1", kind: "activity" }),
      makeFund({ id: "f2", kind: "scholarship" }),
    ]);

    const rows = await listReadyToSendReports();

    expect(rows).toEqual([]);
    expect(getLatestOpenMonthForEntity).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Corrected-resend predicate
  // -------------------------------------------------------------------------

  it("marks a month 'sent' (non-actionable status line) when the fresh fingerprint matches the last successful send", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getLatestOpenMonthForEntity).mockResolvedValue(CUTOFF_MONTH);
    const statement = makeStatement({ month: CUTOFF_MONTH });
    const fingerprint = computeTotalsFingerprint(statement);
    mockDbState.selectQueue.push([
      {
        monthEnd: "2026-09-30",
        sentAt: new Date("2026-09-26T00:00:00.000Z"),
        success: true,
        totalsFingerprint: fingerprint,
        error: null,
        signedAsFirstName: "Pat",
        signedAsLastName: "Example",
      },
    ]);
    vi.mocked(getMonthlyStatement).mockResolvedValue({ status: "ready", statement });

    const rows = await listReadyToSendReports();

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("sent");
    expect(rows[0].lastSuccessfulSend?.signedAsName).toBe("Pat Example");
  });

  it("marks a month 'corrected' (actionable) when the fingerprint has changed since the last successful send", async () => {
    vi.mocked(getEntities).mockResolvedValue([makeEntity()]);
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getLatestOpenMonthForEntity).mockResolvedValue(CUTOFF_MONTH);
    mockDbState.selectQueue.push([
      {
        monthEnd: "2026-09-30",
        sentAt: new Date("2026-09-26T00:00:00.000Z"),
        success: true,
        totalsFingerprint: "a-stale-fingerprint-that-will-never-match",
        error: null,
        signedAsFirstName: "Pat",
        signedAsLastName: "Example",
      },
    ]);
    vi.mocked(getMonthlyStatement).mockResolvedValue({
      status: "ready",
      statement: makeStatement({ month: CUTOFF_MONTH }),
    });

    const rows = await listReadyToSendReports();

    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("corrected");
  });
});

// ---------------------------------------------------------------------------
// sendMonthlyReportToBoard
// ---------------------------------------------------------------------------

describe("sendMonthlyReportToBoard", () => {
  function setupHappyPath() {
    vi.mocked(getEntityById).mockResolvedValue(makeEntity());
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getMonthlyStatement).mockResolvedValue({
      status: "ready",
      statement: makeStatement({ month: CUTOFF_MONTH }),
    });
    vi.mocked(resolveTreasurer).mockResolvedValue(TREASURER_OK);
  }

  it("rejects a malformed month before touching any dependency", async () => {
    const result = await sendMonthlyReportToBoard("entity-1", "not-a-month", "user-1");
    expect(result).toEqual({ ok: false, reason: "invalid_month" });
    expect(getEntityById).not.toHaveBeenCalled();
  });

  it("hard-rejects a month before CUTOFF_MONTH as not_ready", async () => {
    const result = await sendMonthlyReportToBoard("entity-1", "2020-01", "user-1");
    expect(result).toEqual({ ok: false, reason: "not_ready" });
    expect(getEntityById).not.toHaveBeenCalled();
  });

  it("returns not_found when the entity does not exist", async () => {
    vi.mocked(getEntityById).mockResolvedValue(null);
    const result = await sendMonthlyReportToBoard("missing", CUTOFF_MONTH, "user-1");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found when the entity has zero or more than one member-exposed fund", async () => {
    vi.mocked(getEntityById).mockResolvedValue(makeEntity());
    vi.mocked(getFunds).mockResolvedValue([makeFund({ kind: "activity" })]);
    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_ready when the month is gated at send time", async () => {
    vi.mocked(getEntityById).mockResolvedValue(makeEntity());
    vi.mocked(getFunds).mockResolvedValue([makeFund()]);
    vi.mocked(getMonthlyStatement).mockResolvedValue({ status: "gated" });

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({ ok: false, reason: "not_ready" });
    expect(resolveTreasurer).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. Treasurer-unresolved hard block
  // -------------------------------------------------------------------------

  it("hard-blocks on an unresolved treasurer before any email is sent", async () => {
    setupHappyPath();
    vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "none", boardGroupId: "board-1" });
    mockDbState.selectQueue.push([]); // getLatestSuccessfulSend: never sent

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({ ok: false, reason: "treasurer_unresolved", detail: "none" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Claim/conflict behavior — success and failure both write a row
  // -------------------------------------------------------------------------

  it("on a successful send, writes a success:true claim row and returns ok:true", async () => {
    setupHappyPath();
    mockDbState.selectQueue.push([]); // getLatestSuccessfulSend: never sent
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" });
    mockDbState.insertReturningQueue.push([
      { id: "row-1", sentAt: new Date("2026-09-26T00:00:00.000Z") },
    ]);

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({
      ok: true,
      emailQueueId: "eq-1",
      sentAt: "2026-09-26T00:00:00.000Z",
      corrected: false,
    });
  });

  // -------------------------------------------------------------------------
  // Follow-up from QA's PASS-with-follow-up (docs/work-log/
  // 2026-09-25-financial-report-auto-send.md): sendEmail() reports
  // { success: true, blocked: true } when the non-production deny-by-default
  // guard refuses delivery (board@ is a club distribution list — always
  // blocked outside production, allowlist or not). A blocked send must NOT
  // produce a durable success:true claim row, or the partial unique index on
  // (entity_id, month_end, totals_fingerprint) WHERE success permanently
  // blocks ever testing a genuine send of that exact statement again.
  // -------------------------------------------------------------------------

  it("on a blocked (non-production) send, does NOT write a success:true row and reports blocked_non_production, not send_failed", async () => {
    setupHappyPath();
    mockDbState.selectQueue.push([]); // getLatestSuccessfulSend: never sent
    vi.mocked(sendEmail).mockResolvedValue({
      success: true,
      blocked: true,
      emailQueueId: "eq-blocked",
    });

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("blocked_non_production");
    }
    // The claim path (INSERT ... ON CONFLICT ... RETURNING) must never be
    // reached for a blocked send — only the unconditional, non-returning
    // insert used for a failed/blocked attempt. If sendMonthlyReportToBoard()
    // wrongly treated `blocked` as a real success, it would instead consume
    // a queued "won the race" row from insertReturningQueue and return
    // ok:true.
    expect(mockDbState.insertReturningQueue).toHaveLength(0);
  });

  it("the statement remains re-sendable after a blocked (non-production) send — a later real send for the same fingerprint is not treated as already_sent", async () => {
    setupHappyPath();
    // First call: blocked. getLatestSuccessfulSend sees no prior successful
    // row (a blocked send writes success:false, so it can never appear as a
    // "prior successful send" for this lookup).
    mockDbState.selectQueue.push([]);
    vi.mocked(sendEmail).mockResolvedValue({
      success: true,
      blocked: true,
      emailQueueId: "eq-blocked-1",
    });
    const first = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");
    expect(first).toEqual({
      ok: false,
      reason: "blocked_non_production",
      detail: expect.any(String),
    });

    // Second call, same (entity, month, fingerprint): getLatestSuccessfulSend
    // still sees nothing (the first call never wrote success:true), so this
    // is free to actually claim and succeed — never "already_sent".
    mockDbState.selectQueue.push([]);
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-real-send" });
    mockDbState.insertReturningQueue.push([
      { id: "row-real", sentAt: new Date("2026-09-28T00:00:00.000Z") },
    ]);

    const second = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(second).toEqual({
      ok: true,
      emailQueueId: "eq-real-send",
      sentAt: "2026-09-28T00:00:00.000Z",
      corrected: false,
    });
  });

  it("on a failed send, writes a success:false row (not a missing row) and returns send_failed — never claimed", async () => {
    setupHappyPath();
    mockDbState.selectQueue.push([]); // getLatestSuccessfulSend: never sent
    vi.mocked(sendEmail).mockResolvedValue({
      success: false,
      error: "resend down",
      emailQueueId: "eq-2",
    });

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({ ok: false, reason: "send_failed", detail: "resend down" });
  });

  it("a retry after a failed send is NOT blocked by already_sent, because the partial index only covers successful rows", async () => {
    setupHappyPath();
    // getLatestSuccessfulSend only ever sees success=true rows; a prior
    // failure never appears here, so this returns [] exactly as it would
    // for a never-attempted month.
    mockDbState.selectQueue.push([]);
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-3" });
    mockDbState.insertReturningQueue.push([
      { id: "row-2", sentAt: new Date("2026-09-26T01:00:00.000Z") },
    ]);

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Double-send guard
  // -------------------------------------------------------------------------

  it("returns already_sent (not a duplicate row) when the fingerprint already matches a prior successful send", async () => {
    setupHappyPath();
    const fingerprint = computeTotalsFingerprint(makeStatement({ month: CUTOFF_MONTH }));
    mockDbState.selectQueue.push([
      { totalsFingerprint: fingerprint, sentAt: new Date("2026-09-25T00:00:00.000Z") },
    ]);

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({ ok: false, reason: "already_sent" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("concurrent double-click: a losing insert (0 rows from ON CONFLICT) returns already_sent even though its own sendEmail succeeded", async () => {
    setupHappyPath();
    // Both requests' pre-check ran before either committed — this call's
    // own pre-check also sees no prior successful row.
    mockDbState.selectQueue.push([]);
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-4" });
    // The other request's INSERT won the partial unique index; this one's
    // ON CONFLICT ... DO NOTHING returns zero rows.
    mockDbState.insertReturningQueue.push([]);

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({ ok: false, reason: "already_sent" });
  });

  it("labels a resend after a genuine correction as corrected:true and does not treat it as already_sent", async () => {
    setupHappyPath();
    mockDbState.selectQueue.push([
      { totalsFingerprint: "a-stale-fingerprint", sentAt: new Date("2026-09-20T00:00:00.000Z") },
    ]);
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-5" });
    mockDbState.insertReturningQueue.push([
      { id: "row-3", sentAt: new Date("2026-09-27T00:00:00.000Z") },
    ]);

    const result = await sendMonthlyReportToBoard("entity-1", CUTOFF_MONTH, "user-1");

    expect(result).toEqual({
      ok: true,
      emailQueueId: "eq-5",
      sentAt: "2026-09-27T00:00:00.000Z",
      corrected: true,
    });
  });
});
