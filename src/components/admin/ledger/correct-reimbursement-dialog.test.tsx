/**
 * T39 (render): every phase of the Correct / Add bank account dialog, rendered
 * statically through the presentational body (node env, no jsdom).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  CorrectDialogBody,
  type CorrectDialogBodyProps,
  type CorrectDialogPhase,
} from "./correct-reimbursement-dialog";
import { initialCorrectValues } from "./correct-reimbursement-dialog-logic";
import {
  CORRECTION_ERROR_COPY,
  type CorrectionPreview,
  type CorrectResponse,
} from "@/lib/ledger-reimbursement-correction";

const CAT = "c0000000-0000-4000-8000-00000000000a";
const CAT2 = "c0000000-0000-4000-8000-00000000000b";
const BANK = "d0000000-0000-4000-8000-000000000001";

function tx(over: Partial<CorrectionPreview["transaction"]> = {}): CorrectionPreview["transaction"] {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    txnDate: "2026-09-30",
    amountCents: 2500,
    party: "Pat Member",
    memo: "Supplies",
    categoryId: CAT,
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

function preview(
  over: Partial<CorrectionPreview> = {},
  txOver: Partial<CorrectionPreview["transaction"]> = {},
): CorrectionPreview {
  return {
    transaction: tx(txOver),
    callerCanManage: false,
    operations: {
      fill_bank_account: { allowed: true },
      correct: {
        allowed: true,
        tier: { required: "record", reasons: [] },
        dateAndBankEditable: true,
        lockedFields: null,
      },
    },
    options: {
      categories: [
        { id: CAT, name: "Supplies" },
        { id: CAT2, name: "Postage" },
      ],
      bankAccounts: [{ id: BANK, name: "Admin Checking", isDefault: true }],
      defaultBankAccountId: BANK,
      budgetLines: [],
      paymentMethods: ["check", "cash", "other"],
    },
    warnings: [],
    reasonLimits: { min: 10, max: 500 },
    ...over,
  };
}

const noop = () => {};
function body(state: CorrectDialogPhase, over: Partial<CorrectDialogBodyProps> = {}) {
  const values =
    state.phase === "form" ? initialCorrectValues(state.preview.transaction) : initialCorrectValues(tx());
  return renderToStaticMarkup(
    <CorrectDialogBody
      state={state}
      mode="correct"
      values={values}
      reason=""
      submitting={false}
      inlineError={null}
      proposal={{ warnings: state.phase === "form" ? state.preview.warnings : [], denial: null }}
      budgetLineCleared={false}
      onValueChange={noop}
      onReasonChange={noop}
      onSubmit={noop}
      onCancel={noop}
      onDone={noop}
      onRetryLoad={noop}
      {...over}
    />,
  );
}
const DISABLED = /\sdisabled=""/;
function tagOf(html: string, id: string): string | null {
  const m = new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*>`).exec(html);
  return m ? m[0] : null;
}
function submitTag(html: string): string | null {
  const m = /<button([^>]*type="submit"[^>]*)>/.exec(html);
  return m ? m[1] : null;
}
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

describe("CorrectDialogBody phases", () => {
  it("loading renders a status skeleton and no form", () => {
    const html = body({ phase: "loading" });
    expect(html).toContain('role="status"');
    expect(submitTag(html)).toBeNull();
  });

  it("a load error offers Try again", () => {
    const html = body({ phase: "load_error", message: "Something went wrong." });
    expect(html).toContain("Try again");
    expect(submitTag(html)).toBeNull();
  });

  it.each(["not_correctable", "own_request", "manage_required", "matched_open_session", "reconciled_session"] as const)(
    "blocked shows the server's message for %s and no Save",
    (code) => {
      const html = body({ phase: "blocked", message: CORRECTION_ERROR_COPY[code] });
      expect(html).toContain('role="alert"');
      expect(unescape(html)).toContain(CORRECTION_ERROR_COPY[code]);
      expect(submitTag(html)).toBeNull();
    },
  );

  it("the blocked heading names the mode", () => {
    expect(unescape(body({ phase: "blocked", message: "x" }))).toContain("This entry can't be corrected");
    expect(unescape(body({ phase: "blocked", message: "x" }, { mode: "add_bank_account" }))).toContain(
      "A bank account can't be added",
    );
  });

  it("success names the account for Add bank account", () => {
    const result: CorrectResponse = {
      id: "t",
      operation: "fill_bank_account",
      changed: ["bankAccountId"],
      bankAccountName: "Admin Checking",
      budgetLineLinkCleared: false,
      warnings: [],
    };
    const html = body({ phase: "success", result }, { mode: "add_bank_account" });
    expect(html).toContain("Added to Admin Checking. It can now be matched in reconciliation.");
  });
});

describe("CorrectDialogBody form: correct mode", () => {
  const form: CorrectDialogPhase = { phase: "form", preview: preview() };

  it("renders every editable field, the reason and a disabled Save", () => {
    const html = body(form);
    for (const id of [
      "correct-category",
      "correct-budget-line",
      "correct-date",
      "correct-bank",
      "correct-method",
      "correct-check",
      "correct-memo",
      "correct-reason",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("Save correction");
    expect(submitTag(html)).toMatch(DISABLED); // nothing changed, no reason
    expect(html).toContain("book balances");
  });

  it("every control has a label and meets the 44px target", () => {
    const html = body(form);
    expect(html).toContain('for="correct-category"');
    expect(html).toContain('for="correct-date"');
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain("lions-red");
  });

  it("date and bank account are disabled with the reason when dateAndBankEditable is false", () => {
    const locked = preview({
      operations: {
        fill_bank_account: { allowed: true },
        correct: {
          allowed: true,
          tier: { required: "record", reasons: [] },
          dateAndBankEditable: false,
          lockedFields: { code: "matched_open_session", message: "Unmatch it first." },
        },
      },
    });
    const html = body({ phase: "form", preview: locked });
    expect(tagOf(html, "correct-date")).toMatch(DISABLED);
    expect(tagOf(html, "correct-bank")).toMatch(DISABLED);
    expect(tagOf(html, "correct-category")).not.toMatch(DISABLED);
    expect(html).toContain("Unmatch it first.");
  });

  it("shows tier warnings, and statement warnings only once a statement-affecting field changed", () => {
    const warned = preview({
      warnings: [
        { code: "prior_fiscal_year", message: "PRIOR-YEAR-NOTE" },
        { code: "sent_statement", message: "SENT-NOTE" },
        { code: "reports_change", message: "REPORTS-NOTE" },
      ],
    });
    const state: CorrectDialogPhase = { phase: "form", preview: warned };
    const untouched = body(state);
    expect(untouched).toContain("PRIOR-YEAR-NOTE");
    expect(untouched).not.toContain("SENT-NOTE");
    expect(untouched).not.toContain("REPORTS-NOTE");

    const changed = body(state, {
      values: { ...initialCorrectValues(warned.transaction), categoryId: CAT2 },
    });
    expect(changed).toContain("SENT-NOTE");
    expect(changed).toContain("REPORTS-NOTE");

    const memoOnly = body(state, {
      values: { ...initialCorrectValues(warned.transaction), memo: "Edited" },
    });
    expect(memoOnly).not.toContain("SENT-NOTE");
  });

  it("a refused proposal shows its reason and keeps Save disabled even with a reason typed", () => {
    const html = body(form, {
      values: { ...initialCorrectValues(tx()), txnDate: "2026-08-01" },
      reason: "Entered with the wrong date",
      proposal: { warnings: [], denial: { code: "would_hide_statement", reason: "WOULD-HIDE-TEXT" } },
    });
    expect(html).toContain("WOULD-HIDE-TEXT");
    expect(submitTag(html)).toMatch(DISABLED);
  });

  it("Save enables once something changed and the reason is long enough", () => {
    const html = body(form, {
      values: { ...initialCorrectValues(tx()), categoryId: CAT2 },
      reason: "Entered under the wrong category",
    });
    expect(submitTag(html)).not.toMatch(DISABLED);
  });

  it("shows an inline error", () => {
    expect(body(form, { inlineError: "That was not valid." })).toContain("That was not valid.");
  });
});

describe("CorrectDialogBody form: Add bank account mode", () => {
  const form: CorrectDialogPhase = { phase: "form", preview: preview() };
  const values = { ...initialCorrectValues(tx()), bankAccountId: BANK };

  it("has no reason field and no category or date fields", () => {
    const html = body(form, { mode: "add_bank_account", values });
    expect(html).not.toContain("correct-reason");
    expect(html).not.toContain("correct-category");
    expect(html).not.toContain("correct-date");
    expect(html).toContain("Add bank account");
  });

  it("is saveable as soon as an account is chosen, with the check number shown when the row has none", () => {
    const html = body(form, { mode: "add_bank_account", values });
    expect(submitTag(html)).not.toMatch(DISABLED);
    expect(html).toContain('id="correct-check"');
    const none = body(form, { mode: "add_bank_account", values: { ...values, bankAccountId: "" } });
    expect(submitTag(none)).toMatch(DISABLED);
  });

  it("hides the check number when the row already has one", () => {
    const withCheck: CorrectDialogPhase = { phase: "form", preview: preview({}, { checkNumber: "8249" }) };
    expect(body(withCheck, { mode: "add_bank_account", values })).not.toContain('id="correct-check"');
  });

  it("an entity with no active account says so instead of an empty select", () => {
    const empty = preview({ options: { ...preview().options, bankAccounts: [], defaultBankAccountId: null } });
    const html = body(
      { phase: "form", preview: empty },
      { mode: "add_bank_account", values: { ...values, bankAccountId: "" } },
    );
    expect(html).toContain("in Ledger settings first");
    expect(html).not.toContain("<select");
  });
});

describe("dialog source", () => {
  it("never uses a native dialog and uses the shared check-number limit", () => {
    const src = readFileSync(join(__dirname, "correct-reimbursement-dialog.tsx"), "utf8");
    expect(src).not.toMatch(/window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/);
    expect(src).toContain("maxLength={CHECK_NUMBER_MAX_LEN}");
    expect(src).not.toMatch(/maxLength=\{20\}/);
  });
});
