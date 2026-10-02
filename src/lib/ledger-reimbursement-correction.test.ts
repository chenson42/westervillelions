/**
 * T6-T12: the pure vocabulary for correcting a paid reimbursement's row
 * (B-108 / DECISION-114): classifier, exact-key body allowlist, diff, display
 * labels, tier, the code/status map and the warning builder.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { ledgerTransactions } from "@/lib/db/schema";
import {
  CORRECTABLE_FIELDS,
  CORRECTION_ERROR_COPY,
  CORRECTION_ERROR_STATUS,
  CORRECT_BODY_KEYS,
  FILL_BANK_ACCOUNT_REASON,
  FILL_BODY_KEYS,
  buildCorrectionWarnings,
  correctableRowKind,
  describeCorrectionChanges,
  diffCorrection,
  parseCorrectionBody,
  parseCorrectionProposal,
  requiredCorrectionTier,
  wouldHideStatementMessage,
  type CorrectionErrorCode,
} from "./ledger-reimbursement-correction";
import { sentStatementWarning } from "./ledger-correction";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ISO = "2026-10-02T12:00:00.123Z";
const REASON = "Picked the wrong category at pay time";

const fillBody = (over: Record<string, unknown> = {}) => ({
  operation: "fill_bank_account",
  bankAccountId: UUID,
  expectedUpdatedAt: ISO,
  ...over,
});
const correctBody = (over: Record<string, unknown> = {}) => ({
  operation: "correct",
  reason: REASON,
  expectedUpdatedAt: ISO,
  memo: "Postage for the banquet",
  ...over,
});

describe("correctableRowKind (T6)", () => {
  const ok: {
    flow: string;
    status: string;
    approvedAt: Date | null;
    transferGroupId: string | null;
    duesPaymentId: string | null;
  } = {
    flow: "expense",
    status: "posted",
    approvedAt: new Date("2026-10-01"),
    transferGroupId: null,
    duesPaymentId: null,
  };
  it("a paid-reimbursement row is paid_reimbursement", () => {
    expect(correctableRowKind(ok, 1)).toBe("paid_reimbursement");
    expect(correctableRowKind(ok, 2)).toBe("paid_reimbursement");
  });
  it.each<[string, Partial<typeof ok>, number]>([
    ["no linked reimbursement (approved without a link)", {}, 0],
    ["an income row", { flow: "income" }, 1],
    ["a rejected row", { status: "rejected" }, 1],
    ["a pending row", { status: "pending" }, 1],
    ["a transfer leg", { transferGroupId: "g" }, 1],
    ["a dues-synced row", { duesPaymentId: "d" }, 1],
    ["a row without approvedAt", { approvedAt: null }, 1],
  ])("%s is null", (_n, over, linked) => {
    expect(correctableRowKind({ ...ok, ...over }, linked)).toBeNull();
  });
});

describe("parseCorrectionBody allowlist (T7)", () => {
  it("accepts the minimal valid body of each operation", () => {
    expect(parseCorrectionBody(fillBody())).toMatchObject({
      ok: true,
      value: { operation: "fill_bank_account", bankAccountId: UUID, checkNumber: null },
    });
    expect(parseCorrectionBody(correctBody())).toMatchObject({
      ok: true,
      value: { operation: "correct", reason: REASON, changes: { memo: "Postage for the banquet" } },
    });
  });

  it("every ledger_transactions column not in an operation's key set is rejected as Unexpected field", () => {
    const columns = Object.keys(getTableColumns(ledgerTransactions));
    expect(columns.length).toBeGreaterThan(20);
    for (const col of columns) {
      if (!FILL_BODY_KEYS.includes(col)) {
        const r = parseCorrectionBody(fillBody({ [col]: "x" }));
        expect(r, `fill + ${col}`).toEqual({ ok: false, error: `Unexpected field: ${col}.` });
      }
      if (!CORRECT_BODY_KEYS.includes(col)) {
        const r = parseCorrectionBody(correctBody({ [col]: "x" }));
        expect(r, `correct + ${col}`).toEqual({ ok: false, error: `Unexpected field: ${col}.` });
      }
    }
  });

  it("names the dangerous keys explicitly", () => {
    for (const k of ["fundId", "amountCents", "flow", "status", "approvedAt", "approvedByUserId", "boardMinute", "reconciled", "party", "entityId", "receiptStorageKey", "donorId"]) {
      expect(parseCorrectionBody(correctBody({ [k]: 1 }))).toEqual({ ok: false, error: `Unexpected field: ${k}.` });
      expect(parseCorrectionBody(fillBody({ [k]: 1 }))).toEqual({ ok: false, error: `Unexpected field: ${k}.` });
    }
  });

  it("rejects a typo'd key, an unknown or missing operation, and a non-object", () => {
    expect(parseCorrectionBody(correctBody({ categoryID: UUID }))).toEqual({ ok: false, error: "Unexpected field: categoryID." });
    expect(parseCorrectionBody({ ...correctBody(), operation: "delete" })).toMatchObject({ ok: false });
    const { operation: _o, ...noOp } = correctBody();
    void _o;
    expect(parseCorrectionBody(noOp)).toMatchObject({ ok: false });
    expect(parseCorrectionBody(null)).toMatchObject({ ok: false });
    expect(parseCorrectionBody([])).toMatchObject({ ok: false });
    expect(parseCorrectionBody("x")).toMatchObject({ ok: false });
  });

  it("cross-operation keys are rejected: reason on fill; category mixed into fill", () => {
    expect(parseCorrectionBody(fillBody({ reason: REASON }))).toEqual({ ok: false, error: "Unexpected field: reason." });
    expect(parseCorrectionBody(fillBody({ categoryId: UUID2 }))).toEqual({ ok: false, error: "Unexpected field: categoryId." });
    // fill takes only the account and an optional check number
    expect(parseCorrectionBody(fillBody({ checkNumber: " 8249 " }))).toMatchObject({
      ok: true,
      value: { checkNumber: "8249" },
    });
    expect(parseCorrectionBody(fillBody({ checkNumber: "" }))).toMatchObject({ ok: true, value: { checkNumber: null } });
  });

  it("reason bounds: 9 fails, 10 ok, 500 ok, 501 fails", () => {
    expect(parseCorrectionBody(correctBody({ reason: "123456789" }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ reason: "1234567890" }))).toMatchObject({ ok: true });
    expect(parseCorrectionBody(correctBody({ reason: "x".repeat(500) }))).toMatchObject({ ok: true });
    expect(parseCorrectionBody(correctBody({ reason: "x".repeat(501) }))).toMatchObject({ ok: false });
    const { reason: _r, ...noReason } = correctBody();
    void _r;
    expect(parseCorrectionBody(noReason)).toMatchObject({ ok: false });
  });

  it("value rules for each correctable field", () => {
    expect(parseCorrectionBody(correctBody({ categoryId: null }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ categoryId: "nope" }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ memo: "" }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ memo: "   " }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ memo: null }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ memo: "x".repeat(1001) }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ memo: "x".repeat(1000) }))).toMatchObject({ ok: true });
    expect(parseCorrectionBody(correctBody({ bankAccountId: null }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ bankAccountId: "x" }))).toMatchObject({ ok: false });
    const { memo: _memo, ...noMemo } = correctBody({ budgetLineId: null });
    void _memo;
    expect(parseCorrectionBody(noMemo)).toMatchObject({
      ok: true,
      value: { changes: { budgetLineId: null } },
    });
    expect(parseCorrectionBody(correctBody({ budgetLineId: UUID2 }))).toMatchObject({ ok: true });
    expect(parseCorrectionBody(correctBody({ budgetLineId: "x" }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ paymentMethod: "zeffy" }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ paymentMethod: "cash" }))).toMatchObject({ ok: true });
    expect(parseCorrectionBody(correctBody({ txnDate: "2026-02-31" }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ txnDate: "2026-09-12" }))).toMatchObject({ ok: true });
    expect(parseCorrectionBody(correctBody({ checkNumber: "1".repeat(21) }))).toMatchObject({ ok: false });
    expect(parseCorrectionBody(correctBody({ checkNumber: null }))).toMatchObject({
      ok: true,
      value: { changes: { checkNumber: null } },
    });
    expect(parseCorrectionBody(correctBody({ checkNumber: 12 }))).toMatchObject({ ok: false });
  });

  it("a correct with no editable field is rejected", () => {
    const { memo: _m, ...noField } = correctBody();
    void _m;
    expect(parseCorrectionBody(noField)).toEqual({ ok: false, error: "Change at least one field." });
  });

  it("expectedUpdatedAt must be an ISO string", () => {
    for (const bad of [undefined, 5, "yesterday", "2026-10-02", "2026-13-45T00:00:00Z"]) {
      expect(parseCorrectionBody(fillBody({ expectedUpdatedAt: bad }))).toMatchObject({ ok: false });
      expect(parseCorrectionBody(correctBody({ expectedUpdatedAt: bad }))).toMatchObject({ ok: false });
    }
  });

  it("the key-set constants cover exactly the documented fields", () => {
    expect([...FILL_BODY_KEYS].sort()).toEqual(["bankAccountId", "checkNumber", "expectedUpdatedAt", "operation"]);
    expect([...CORRECT_BODY_KEYS].sort()).toEqual(
      ["expectedUpdatedAt", "operation", "reason", ...CORRECTABLE_FIELDS].sort(),
    );
    // the approval stamp and amount are not writable by construction
    for (const forbidden of ["approvedAt", "approvedByUserId", "boardMinute", "amountCents", "fundId", "flow", "status", "party"]) {
      expect(CORRECT_BODY_KEYS).not.toContain(forbidden);
      expect(FILL_BODY_KEYS).not.toContain(forbidden);
    }
  });

  it("GET proposal params: valid, absent and malformed", () => {
    expect(parseCorrectionProposal(new URLSearchParams(""))).toEqual({ ok: true, value: {} });
    expect(parseCorrectionProposal(new URLSearchParams("txnDate=2026-09-12&paymentMethod=cash"))).toEqual({
      ok: true,
      value: { txnDate: "2026-09-12", paymentMethod: "cash" },
    });
    expect(parseCorrectionProposal(new URLSearchParams("txnDate=2026-02-31"))).toMatchObject({ ok: false });
    expect(parseCorrectionProposal(new URLSearchParams("paymentMethod=zelle"))).toMatchObject({ ok: false });
  });
});

describe("diffCorrection (T8)", () => {
  const stored = {
    categoryId: UUID,
    budgetLineId: null,
    txnDate: "2026-09-30",
    paymentMethod: "check",
    checkNumber: null,
    memo: "Supplies",
    bankAccountId: UUID2,
  };
  it("drops fields equal to the stored value", () => {
    const { changes, changed } = diffCorrection(stored, {
      categoryId: UUID,
      txnDate: "2026-09-30",
      memo: "Supplies",
      budgetLineId: null,
      checkNumber: null,
    });
    expect(changes).toEqual({});
    expect(changed).toEqual([]);
  });
  it("reports survivors in canonical order regardless of request order", () => {
    const { changes, changed } = diffCorrection(stored, {
      bankAccountId: "c",
      memo: "New",
      checkNumber: "8249",
      paymentMethod: "cash",
      txnDate: "2026-09-12",
      budgetLineId: "bl",
      categoryId: UUID2,
    });
    expect(changed).toEqual(["categoryId", "budgetLineId", "txnDate", "paymentMethod", "checkNumber", "memo", "bankAccountId"]);
    expect(Object.keys(changes)).toEqual(changed);
  });
  it("a null clear is a change only when a value is stored", () => {
    expect(diffCorrection({ ...stored, checkNumber: "1" }, { checkNumber: null }).changed).toEqual(["checkNumber"]);
    expect(diffCorrection(stored, { checkNumber: null }).changed).toEqual([]);
  });
});

describe("describeCorrectionChanges (T9)", () => {
  it("labels a fill with and without a check number", () => {
    expect(
      describeCorrectionChanges({ v: 1, bankAccount: null }, { v: 1, bankAccount: { id: "b", name: "Checking" } }),
    ).toEqual(["Bank account added: Checking"]);
    expect(
      describeCorrectionChanges(
        { v: 1, bankAccount: null, checkNumber: null },
        { v: 1, bankAccount: { id: "b", name: "Checking" }, checkNumber: "8249" },
      ),
    ).toEqual(["Check number added: 8249", "Bank account added: Checking"]);
  });
  it("labels each field", () => {
    expect(
      describeCorrectionChanges(
        {
          v: 1,
          category: { id: "1", name: "Supplies" },
          txnDate: "2026-09-15",
          paymentMethod: "check",
          checkNumber: "1",
          bankAccount: { id: "a", name: "Savings" },
        },
        {
          v: 1,
          category: { id: "2", name: "Postage" },
          txnDate: "2026-09-12",
          paymentMethod: "cash",
          checkNumber: "2",
          bankAccount: { id: "b", name: "Checking" },
        },
      ),
    ).toEqual([
      "Category: Supplies to Postage",
      "Date: 2026-09-15 to 2026-09-12",
      "Payment method: Check to Cash",
      "Check number: 1 to 2",
      "Bank account: Savings to Checking",
    ]);
    expect(describeCorrectionChanges({ v: 1, checkNumber: "1" }, { v: 1, checkNumber: null })).toEqual(["Check number cleared"]);
    expect(describeCorrectionChanges({ v: 1, budgetLineId: "x" }, { v: 1, budgetLineId: null })).toEqual(["Budget line cleared"]);
    expect(describeCorrectionChanges({ v: 1, budgetLineId: null }, { v: 1, budgetLineId: "y" })).toEqual(["Budget line changed"]);
  });
  it("never renders memo text", () => {
    const out = describeCorrectionChanges({ v: 1, memo: "PRIVATE old" }, { v: 1, memo: "PRIVATE new" });
    expect(out).toEqual(["Description edited"]);
    expect(JSON.stringify(out)).not.toContain("PRIVATE");
  });
});

describe("requiredCorrectionTier (T10)", () => {
  const NOW = new Date(2026, 9, 2); // FY2026
  const row = (over: Record<string, unknown> = {}) => ({
    reconciled: false,
    reconciledSessionId: null,
    txnDate: "2026-09-15",
    ...over,
  });
  it("an unreconciled current-FY row is record", () => {
    expect(requiredCorrectionTier(row(), {}, NOW)).toEqual({ tier: "record", reasons: [] });
  });
  it("session and legacy reconciled rows are manage: reconciled", () => {
    expect(requiredCorrectionTier(row({ reconciled: true, reconciledSessionId: "s" }), {}, NOW)).toEqual({ tier: "manage", reasons: ["reconciled"] });
    expect(requiredCorrectionTier(row({ reconciled: true }), {}, NOW)).toEqual({ tier: "manage", reasons: ["reconciled"] });
  });
  it("a prior-FY row is manage: prior_fiscal_year", () => {
    expect(requiredCorrectionTier(row({ txnDate: "2026-03-01" }), {}, NOW)).toEqual({ tier: "manage", reasons: ["prior_fiscal_year"] });
  });
  it("a date crossing a fiscal-year boundary adds fiscal_year_change, and into a prior FY adds prior_fiscal_year", () => {
    // current-FY row moved into June 2026 (FY2025)
    expect(requiredCorrectionTier(row({ txnDate: "2026-07-05" }), { newTxnDate: "2026-06-28" }, NOW)).toEqual({
      tier: "manage",
      reasons: ["prior_fiscal_year", "fiscal_year_change"],
    });
    // prior row moved forward into the current FY: prior_fiscal_year (row) + fiscal_year_change
    expect(requiredCorrectionTier(row({ txnDate: "2026-06-30" }), { newTxnDate: "2026-07-01" }, NOW)).toEqual({
      tier: "manage",
      reasons: ["prior_fiscal_year", "fiscal_year_change"],
    });
  });
  it("a same-FY date change on an unreconciled current row stays record", () => {
    expect(requiredCorrectionTier(row(), { newTxnDate: "2026-09-02" }, NOW)).toEqual({ tier: "record", reasons: [] });
    expect(requiredCorrectionTier(row(), { newTxnDate: "2026-09-15" }, NOW)).toEqual({ tier: "record", reasons: [] });
  });
  it("`now` edges: 2026-06-30 is still FY2025, 2026-07-01 is FY2026", () => {
    const june30 = new Date(2026, 5, 30);
    const july1 = new Date(2026, 6, 1);
    expect(requiredCorrectionTier(row({ txnDate: "2026-06-15" }), {}, june30).tier).toBe("record");
    expect(requiredCorrectionTier(row({ txnDate: "2026-06-15" }), {}, july1).tier).toBe("manage");
  });
});

describe("error codes and copy (T11)", () => {
  const ALL = Object.keys(CORRECTION_ERROR_STATUS) as CorrectionErrorCode[];
  it("every code has a status and a non-empty copy string", () => {
    expect(Object.keys(CORRECTION_ERROR_COPY).sort()).toEqual([...ALL].sort());
    for (const c of ALL) {
      expect([400, 403, 404, 409]).toContain(CORRECTION_ERROR_STATUS[c]);
      expect(CORRECTION_ERROR_COPY[c].length).toBeGreaterThan(0);
    }
  });
  it("the status map is pinned", () => {
    expect(CORRECTION_ERROR_STATUS).toEqual({
      invalid_body: 400,
      no_change: 400,
      category_invalid: 400,
      bank_account_invalid: 400,
      budget_line_invalid: 400,
      forbidden: 403,
      not_correctable: 403,
      own_request: 403,
      manage_required: 403,
      reconciled_session: 403,
      reconciled_legacy: 403,
      matched_open_session: 403,
      not_found: 404,
      category_not_found: 404,
      budget_line_not_found: 404,
      stale: 409,
      already_has_bank_account: 409,
      check_number_present: 409,
      would_hide_statement: 409,
    });
  });
  it("the manage copy names the permission, never a role", () => {
    expect(CORRECTION_ERROR_COPY.manage_required).toMatch(/Manage Ledger permission/);
    expect(CORRECTION_ERROR_COPY.manage_required).not.toMatch(/treasurer|admin role/i);
  });
  it("the fixed fill reason is a constant sentence", () => {
    expect(FILL_BANK_ACCOUNT_REASON.length).toBeGreaterThan(10);
  });
  it("the hide-statement message differs for a date and a method change", () => {
    const date = wouldHideStatementMessage({ hiddenMonth: "2026-08", newDate: "2026-08-15", currentMonth: "2026-09", methodChange: false });
    expect(date).toMatch(/August 2026/);
    expect(date).toMatch(/September 2026 or later/);
    const method = wouldHideStatementMessage({ hiddenMonth: "2026-09", newDate: null, currentMonth: "2026-09", methodChange: true });
    expect(method).toMatch(/away from Check/);
  });
});

describe("buildCorrectionWarnings (T12)", () => {
  const base = {
    tierReasons: [] as ("reconciled" | "prior_fiscal_year" | "fiscal_year_change")[],
    sentStatementMonth: "2026-09",
    newSentStatementMonth: null as string | null,
    statementLabel: "Administrative",
  };
  const codes = (w: { code: string }[]) => w.map((x) => x.code);

  it("sent_statement only for a statement-affecting change", () => {
    expect(codes(buildCorrectionWarnings({ ...base, changed: ["categoryId"] }))).toEqual(["sent_statement", "reports_change"]);
    expect(codes(buildCorrectionWarnings({ ...base, changed: ["paymentMethod"] }))).toEqual(["sent_statement"]);
    expect(codes(buildCorrectionWarnings({ ...base, changed: ["budgetLineId"] }))).toEqual(["sent_statement"]);
    for (const f of ["memo", "checkNumber", "bankAccountId"] as const) {
      expect(buildCorrectionWarnings({ ...base, changed: [f] })).toEqual([]);
    }
  });
  it("new_month_sent_statement only when the month changes to a sent one", () => {
    expect(codes(buildCorrectionWarnings({ ...base, changed: ["txnDate"], newSentStatementMonth: "2026-08" }))).toEqual([
      "sent_statement",
      "new_month_sent_statement",
      "reports_change",
    ]);
    expect(codes(buildCorrectionWarnings({ ...base, changed: ["txnDate"], newSentStatementMonth: "2026-09" }))).toEqual([
      "sent_statement",
      "reports_change",
    ]);
    expect(codes(buildCorrectionWarnings({ ...base, changed: ["txnDate"] }))).toEqual(["sent_statement", "reports_change"]);
  });
  it("tier reasons add the reconciled and prior-year warnings", () => {
    expect(
      codes(buildCorrectionWarnings({ ...base, sentStatementMonth: null, tierReasons: ["reconciled", "prior_fiscal_year"], changed: ["memo"] })),
    ).toEqual(["reconciled", "prior_fiscal_year"]);
  });
  it("the correction copy has no 'move' wording and the default is byte-identical", () => {
    const correction = sentStatementWarning("2026-09", "Administrative", "correction");
    expect(correction).toContain("After this correction");
    expect(correction).not.toMatch(/\bmove\b/i);
    expect(sentStatementWarning("2026-09")).toBe(
      "The Administrative statement for September 2026 was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically.",
    );
    expect(sentStatementWarning("2026-09", "Club")).toContain("The Club statement");
  });
});
