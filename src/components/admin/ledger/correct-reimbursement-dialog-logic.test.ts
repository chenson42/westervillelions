/** T39 (logic): the Correct / Add bank account dialog's pure rules. */

import { describe, it, expect } from "vitest";
import {
  applyValuePatch,
  buildCorrectBody,
  changesFromValues,
  correctBlockReason,
  correctFailureAction,
  correctSuccessMessage,
  initialCorrectValues,
  initialFillBankAccountId,
  proposalQuery,
  resolveCorrectClose,
  storedValuesOf,
  visibleWarnings,
  type CorrectFormValues,
} from "./correct-reimbursement-dialog-logic";
import {
  CORRECTION_FAILED_MESSAGE,
  type CorrectionPreview,
  type CorrectionWarning,
} from "@/lib/ledger-reimbursement-correction";

const TXN = "b0000000-0000-4000-8000-000000000001";
const CAT_A = "c0000000-0000-4000-8000-00000000000a";
const CAT_B = "c0000000-0000-4000-8000-00000000000b";
const BANK = "d0000000-0000-4000-8000-000000000001";
const BANK2 = "d0000000-0000-4000-8000-000000000002";
const LINE = "f0000000-0000-4000-8000-000000000001";

function previewTx(over: Partial<CorrectionPreview["transaction"]> = {}): CorrectionPreview["transaction"] {
  return {
    id: TXN,
    txnDate: "2026-09-30",
    amountCents: 2500,
    party: "Pat Member",
    memo: "Supplies",
    categoryId: CAT_A,
    categoryName: "Supplies",
    budgetLineId: null,
    paymentMethod: "check",
    checkNumber: null,
    bankAccountId: null,
    bankAccountName: null,
    fundId: "a0000000-0000-4000-8000-000000000001",
    fundName: "Administrative Fund",
    fundKind: "administrative",
    entity: { id: "e1", slug: "club", name: "Club" },
    fiscalYear: 2027,
    reconciled: false,
    matched: false,
    updatedAt: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

describe("changesFromValues / buildCorrectBody", () => {
  const stored = storedValuesOf(previewTx({ checkNumber: "8249", bankAccountId: BANK }));

  it("an untouched form changes nothing", () => {
    const values = initialCorrectValues(previewTx({ checkNumber: "8249", bankAccountId: BANK }));
    expect(changesFromValues(stored, values).changed).toEqual([]);
  });

  it("sends only the fields the user changed", () => {
    const values = { ...initialCorrectValues(previewTx({ checkNumber: "8249", bankAccountId: BANK })), categoryId: CAT_B };
    const body = buildCorrectBody({
      mode: "correct",
      stored,
      values,
      reason: "  Entered under the wrong category  ",
      expectedUpdatedAt: "2026-10-01T12:00:00.000Z",
    });
    expect(body).toEqual({
      operation: "correct",
      reason: "Entered under the wrong category",
      expectedUpdatedAt: "2026-10-01T12:00:00.000Z",
      categoryId: CAT_B,
    });
  });

  it("an unchanged resend of the date is not sent (it would trip the reconciled refusal)", () => {
    const values = initialCorrectValues(previewTx({ checkNumber: "8249", bankAccountId: BANK }));
    const body = buildCorrectBody({ mode: "correct", stored, values: { ...values, memo: "Supplies, fall drive" }, reason: "r".repeat(12), expectedUpdatedAt: "x" });
    expect(body).not.toHaveProperty("txnDate");
    expect(body).not.toHaveProperty("bankAccountId");
    expect(body.memo).toBe("Supplies, fall drive");
  });

  it("clearing the check number or budget line is a deliberate null; other fields are never cleared", () => {
    const values: CorrectFormValues = {
      ...initialCorrectValues(previewTx({ checkNumber: "8249", bankAccountId: BANK, budgetLineId: LINE })),
      checkNumber: "  ",
      budgetLineId: "",
      memo: "",
      categoryId: "",
      paymentMethod: "",
    };
    const { changes } = changesFromValues(
      storedValuesOf(previewTx({ checkNumber: "8249", bankAccountId: BANK, budgetLineId: LINE })),
      values,
    );
    expect(changes).toEqual({ checkNumber: null, budgetLineId: null });
  });

  it("Add bank account sends the account and NO reason; the check number only when the row has none", () => {
    const noCheck = storedValuesOf(previewTx());
    const values = { ...initialCorrectValues(previewTx()), bankAccountId: BANK, checkNumber: " 8249 " };
    const body = buildCorrectBody({ mode: "add_bank_account", stored: noCheck, values, reason: "ignored", expectedUpdatedAt: "t" });
    expect(body).toEqual({ operation: "fill_bank_account", bankAccountId: BANK, expectedUpdatedAt: "t", checkNumber: "8249" });
    expect(body).not.toHaveProperty("reason");

    const hasCheck = storedValuesOf(previewTx({ checkNumber: "1" }));
    const body2 = buildCorrectBody({ mode: "add_bank_account", stored: hasCheck, values: { ...values, checkNumber: "2" }, reason: "", expectedUpdatedAt: "t" });
    expect(body2).not.toHaveProperty("checkNumber");
  });
});

describe("initialFillBankAccountId", () => {
  const preview = {
    options: {
      bankAccounts: [
        { id: BANK, name: "Checking", isDefault: true },
        { id: BANK2, name: "Savings", isDefault: false },
      ],
      defaultBankAccountId: BANK,
    },
  } as unknown as CorrectionPreview;
  it("prefers a valid preselection (the session's account), then the default, else blank", () => {
    expect(initialFillBankAccountId(preview, BANK2)).toBe(BANK2);
    expect(initialFillBankAccountId(preview, "not-an-option")).toBe(BANK);
    expect(initialFillBankAccountId(preview, null)).toBe(BANK);
    const none = { options: { bankAccounts: [], defaultBankAccountId: null } } as unknown as CorrectionPreview;
    expect(initialFillBankAccountId(none, null)).toBe("");
  });
});

describe("proposalQuery", () => {
  it("includes only a date or method that differs from the stored value", () => {
    const stored = { txnDate: "2026-09-30", paymentMethod: "check" };
    expect(proposalQuery(stored, { txnDate: "2026-09-30", paymentMethod: "check" })).toBe("");
    expect(proposalQuery(stored, { txnDate: "2026-09-12", paymentMethod: "check" })).toBe("?txnDate=2026-09-12");
    expect(proposalQuery(stored, { txnDate: "2026-09-30", paymentMethod: "cash" })).toBe("?paymentMethod=cash");
    expect(proposalQuery(stored, { txnDate: "2026-09-12", paymentMethod: "cash" })).toBe("?txnDate=2026-09-12&paymentMethod=cash");
    expect(proposalQuery(stored, { txnDate: "", paymentMethod: "" })).toBe("");
  });
});

describe("visibleWarnings", () => {
  const all: CorrectionWarning[] = [
    { code: "reconciled", message: "r" },
    { code: "prior_fiscal_year", message: "p" },
    { code: "sent_statement", message: "s" },
    { code: "new_month_sent_statement", message: "n" },
    { code: "reports_change", message: "x" },
  ];
  const codes = (w: CorrectionWarning[]) => w.map((x) => x.code);

  it("always shows the tier warnings, and hides statement and reports warnings for a memo-only change", () => {
    expect(codes(visibleWarnings(all, ["memo"]))).toEqual(["reconciled", "prior_fiscal_year"]);
    expect(codes(visibleWarnings(all, []))).toEqual(["reconciled", "prior_fiscal_year"]);
    expect(codes(visibleWarnings(all, ["bankAccountId", "checkNumber"]))).toEqual(["reconciled", "prior_fiscal_year"]);
  });

  it("shows the sent-statement warnings for category, date, method or budget line", () => {
    for (const f of ["categoryId", "txnDate", "paymentMethod", "budgetLineId"] as const) {
      expect(codes(visibleWarnings(all, [f]))).toContain("sent_statement");
    }
  });

  it("shows reports_change only for category or date", () => {
    expect(codes(visibleWarnings(all, ["categoryId"]))).toContain("reports_change");
    expect(codes(visibleWarnings(all, ["txnDate"]))).toContain("reports_change");
    expect(codes(visibleWarnings(all, ["paymentMethod"]))).not.toContain("reports_change");
    expect(codes(visibleWarnings(all, ["budgetLineId"]))).not.toContain("reports_change");
  });
});

describe("correctBlockReason", () => {
  const stored = storedValuesOf(previewTx());
  const base = {
    mode: "correct" as const,
    stored,
    values: { ...initialCorrectValues(previewTx()), categoryId: CAT_B },
    reason: "A good enough reason",
    reasonMin: 10,
    reasonMax: 500,
    denied: false,
  };
  it("saves when something changed, the reason is long enough and nothing is denied", () => {
    expect(correctBlockReason(base)).toBeNull();
  });
  it("requires a change, a reason of the right length, and no server denial", () => {
    expect(correctBlockReason({ ...base, values: initialCorrectValues(previewTx()) })).toMatch(/at least one field/);
    expect(correctBlockReason({ ...base, reason: "short" })).toMatch(/at least 10/);
    expect(correctBlockReason({ ...base, reason: "x".repeat(501) })).toMatch(/at most 500/);
    expect(correctBlockReason({ ...base, denied: true })).toMatch(/can't be saved/);
  });
  it("refuses a blank register description and an over-long check number", () => {
    expect(correctBlockReason({ ...base, values: { ...base.values, memo: " " } })).toMatch(/can't be blank/);
    expect(correctBlockReason({ ...base, values: { ...base.values, checkNumber: "9".repeat(21) } })).toMatch(/at most 20/);
  });
  it("Add bank account needs an account and NO reason", () => {
    expect(correctBlockReason({ ...base, mode: "add_bank_account", reason: "", values: { ...base.values, bankAccountId: "" } })).toMatch(/Choose a bank account/);
    expect(correctBlockReason({ ...base, mode: "add_bank_account", reason: "", values: { ...base.values, bankAccountId: BANK } })).toBeNull();
  });
});

describe("correctFailureAction", () => {
  it("403, 404 and 409 toast, close and refresh", () => {
    for (const status of [403, 404, 409]) {
      expect(correctFailureAction(status, { error: "No.", code: "stale" }).mode).toBe("close_and_refresh");
    }
    expect(correctFailureAction(403, { error: "Matched.", code: "matched_open_session" })).toEqual({
      mode: "close_and_refresh",
      message: "Matched.",
    });
  });
  it("400 is inline", () => {
    expect(correctFailureAction(400, { error: "Bad reason.", code: "invalid_body" })).toEqual({ mode: "inline", message: "Bad reason." });
  });
  it("two fixable 409s stay inline so the form survives", () => {
    expect(correctFailureAction(409, { error: "Would hide.", code: "would_hide_statement" }).mode).toBe("inline");
    expect(correctFailureAction(409, { error: "Has one.", code: "check_number_present" }).mode).toBe("inline");
  });
  it("500 and unreadable bodies retry with the fixed message", () => {
    expect(correctFailureAction(500, null)).toEqual({ mode: "retry", message: CORRECTION_FAILED_MESSAGE });
    expect(correctFailureAction(502, { error: "gateway" })).toEqual({ mode: "retry", message: CORRECTION_FAILED_MESSAGE });
  });
});

describe("success copy and close", () => {
  it("names the account for Add bank account", () => {
    expect(correctSuccessMessage({ operation: "fill_bank_account", bankAccountName: "Admin Checking" })).toBe(
      "Added to Admin Checking. It can now be matched in reconciliation.",
    );
    expect(correctSuccessMessage({ operation: "correct", bankAccountName: null })).toMatch(/Correction saved/);
  });
  it("ignores a close while submitting and refreshes after a success", () => {
    expect(resolveCorrectClose({ nextOpen: false, phase: "form", submitting: true })).toEqual({ proceed: false, refresh: false });
    expect(resolveCorrectClose({ nextOpen: false, phase: "success", submitting: false })).toEqual({ proceed: true, refresh: true });
    expect(resolveCorrectClose({ nextOpen: false, phase: "blocked", submitting: false })).toEqual({ proceed: true, refresh: false });
  });
});

describe("applyValuePatch: budget-line coherence", () => {
  const lines = [{ id: LINE, categoryId: CAT_A, fiscalYear: 2027 }];
  const fy = (iso: string) => (iso >= "2026-07-01" ? 2027 : 2026);
  const current = { ...initialCorrectValues(previewTx({ budgetLineId: LINE })) };

  it("keeps the line when category and fiscal year still fit", () => {
    const r = applyValuePatch(current, { txnDate: "2026-09-12" }, lines, fy);
    expect(r.values.budgetLineId).toBe(LINE);
    expect(r.budgetLineCleared).toBe(false);
  });
  it("clears it when the category changes", () => {
    const r = applyValuePatch(current, { categoryId: CAT_B }, lines, fy);
    expect(r.values.budgetLineId).toBe("");
    expect(r.budgetLineCleared).toBe(true);
  });
  it("clears it when the date leaves the line's fiscal year", () => {
    const r = applyValuePatch(current, { txnDate: "2026-05-01" }, lines, fy);
    expect(r.values.budgetLineId).toBe("");
    expect(r.budgetLineCleared).toBe(true);
  });
  it("never clears on an explicit budget-line pick", () => {
    const r = applyValuePatch(current, { budgetLineId: "" }, lines, fy);
    expect(r.budgetLineCleared).toBe(false);
  });
});
