/**
 * Pure helpers for the Correct / Add bank account dialog (B-108 / DECISION-114,
 * T39): the form model, the request body (only changed fields), the proposal
 * query, which warnings to show, and how each failure is routed. DOM-less so
 * every rule is unit-testable.
 */

import {
  CORRECTION_FAILED_MESSAGE,
  CORRECTION_ERROR_COPY,
  diffCorrection,
  isStatementAffecting,
  type CorrectChanges,
  type CorrectableField,
  type CorrectionErrorBody,
  type CorrectionPreview,
  type CorrectionWarning,
  type CorrectResponse,
  type StoredCorrectableValues,
} from "@/lib/ledger-reimbursement-correction";
import {
  CHECK_NUMBER_MAX_LEN,
  isReimbursementPaymentMethod,
  pickDefaultBankAccount,
} from "@/lib/ledger";

export type CorrectMode = "add_bank_account" | "correct";

type PreviewTransaction = CorrectionPreview["transaction"];

/** Every editable field as the form holds it (strings; "" means none). */
export interface CorrectFormValues {
  categoryId: string;
  budgetLineId: string;
  txnDate: string;
  paymentMethod: string;
  checkNumber: string;
  memo: string;
  bankAccountId: string;
}

export function storedValuesOf(tx: PreviewTransaction): StoredCorrectableValues {
  return {
    categoryId: tx.categoryId,
    budgetLineId: tx.budgetLineId,
    txnDate: tx.txnDate,
    paymentMethod: tx.paymentMethod,
    checkNumber: tx.checkNumber,
    memo: tx.memo,
    bankAccountId: tx.bankAccountId,
  };
}

export function initialCorrectValues(tx: PreviewTransaction): CorrectFormValues {
  return {
    categoryId: tx.categoryId ?? "",
    budgetLineId: tx.budgetLineId ?? "",
    txnDate: tx.txnDate,
    paymentMethod: tx.paymentMethod ?? "",
    checkNumber: tx.checkNumber ?? "",
    memo: tx.memo ?? "",
    bankAccountId: tx.bankAccountId ?? "",
  };
}

/**
 * The bank account the Add bank account form starts on: the caller's
 * preselection (the open session's account) when it is a valid option, else the
 * entity default, else "" (the user must choose).
 */
export function initialFillBankAccountId(
  preview: Pick<CorrectionPreview, "options">,
  preselectBankAccountId?: string | null,
): string {
  const { bankAccounts, defaultBankAccountId } = preview.options;
  if (preselectBankAccountId && bankAccounts.some((a) => a.id === preselectBankAccountId)) {
    return preselectBankAccountId;
  }
  if (defaultBankAccountId && bankAccounts.some((a) => a.id === defaultBankAccountId)) {
    return defaultBankAccountId;
  }
  return pickDefaultBankAccount(bankAccounts)?.id ?? "";
}

/**
 * The changes the user actually made, in the server's own vocabulary. A field
 * is requested only when it differs from the stored value; categories, methods,
 * descriptions and bank accounts are never cleared (the server rejects null),
 * so a blank there is "not requested", not "clear". A cleared budget line or
 * check number is a deliberate null. Reuses the server's `diffCorrection`, so
 * "unchanged" means exactly what it means there.
 */
export function changesFromValues(
  stored: StoredCorrectableValues,
  values: CorrectFormValues,
): { changes: CorrectChanges; changed: CorrectableField[] } {
  const requested: CorrectChanges = {};
  if (values.categoryId) requested.categoryId = values.categoryId;
  requested.budgetLineId = values.budgetLineId || null;
  if (values.txnDate) requested.txnDate = values.txnDate;
  if (isReimbursementPaymentMethod(values.paymentMethod)) {
    requested.paymentMethod = values.paymentMethod;
  }
  requested.checkNumber = values.checkNumber.trim() || null;
  const memo = values.memo.trim();
  if (memo) requested.memo = memo;
  if (values.bankAccountId) requested.bankAccountId = values.bankAccountId;
  return diffCorrection(stored, requested);
}

export interface CorrectBodyInput {
  mode: CorrectMode;
  stored: StoredCorrectableValues;
  values: CorrectFormValues;
  reason: string;
  expectedUpdatedAt: string;
}

/**
 * The POST body. Add bank account: bank account, the check number only when the
 * row has none and one was typed, and NO reason (the server writes a fixed one).
 * Correct: the reason plus only the fields that changed.
 */
export function buildCorrectBody(input: CorrectBodyInput): Record<string, unknown> {
  if (input.mode === "add_bank_account") {
    const body: Record<string, unknown> = {
      operation: "fill_bank_account",
      bankAccountId: input.values.bankAccountId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
    const check = input.values.checkNumber.trim();
    if (!input.stored.checkNumber && check) body.checkNumber = check;
    return body;
  }
  const { changes } = changesFromValues(input.stored, input.values);
  return {
    operation: "correct",
    reason: input.reason.trim(),
    expectedUpdatedAt: input.expectedUpdatedAt,
    ...changes,
  };
}

/**
 * The GET query for the live proposal: only the date and method, and only when
 * they differ from the stored values (the server evaluates the warnings and the
 * `would_hide_statement` / state refusals for them before Save). Returns "" when
 * nothing differs.
 */
export function proposalQuery(
  stored: Pick<StoredCorrectableValues, "txnDate" | "paymentMethod">,
  values: Pick<CorrectFormValues, "txnDate" | "paymentMethod">,
): string {
  const params = new URLSearchParams();
  if (values.txnDate && values.txnDate !== stored.txnDate && /^\d{4}-\d{2}-\d{2}$/.test(values.txnDate)) {
    params.set("txnDate", values.txnDate);
  }
  if (
    isReimbursementPaymentMethod(values.paymentMethod) &&
    values.paymentMethod !== stored.paymentMethod
  ) {
    params.set("paymentMethod", values.paymentMethod);
  }
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Which warnings to show for what the user has changed. Tier warnings
 * (`reconciled`, `prior_fiscal_year`) always show. The baseline GET carries the
 * worst case, so the statement and reports warnings show only once the user has
 * changed a field that can restate them: a sent-statement warning for
 * category, date, method or budget line; "reports change" for category or date.
 */
export function visibleWarnings(
  warnings: readonly CorrectionWarning[],
  changed: readonly CorrectableField[],
): CorrectionWarning[] {
  const statement = isStatementAffecting(changed);
  const reports = changed.includes("categoryId") || changed.includes("txnDate");
  return warnings.filter((w) => {
    switch (w.code) {
      case "reconciled":
      case "prior_fiscal_year":
        return true;
      case "sent_statement":
      case "new_month_sent_statement":
        return statement;
      case "reports_change":
        return reports;
      default: {
        const unreachable: never = w.code;
        return unreachable;
      }
    }
  });
}

/** Why the form cannot be saved yet, or null when it can. */
export function correctBlockReason(input: {
  mode: CorrectMode;
  stored: StoredCorrectableValues;
  values: CorrectFormValues;
  reason: string;
  reasonMin: number;
  reasonMax: number;
  denied: boolean;
}): string | null {
  if (input.mode === "add_bank_account") {
    return input.values.bankAccountId ? null : "Choose a bank account.";
  }
  if (input.stored.memo && !input.values.memo.trim()) {
    return "The register description can't be blank.";
  }
  if (input.values.checkNumber.trim().length > CHECK_NUMBER_MAX_LEN) {
    return `The check number can be at most ${CHECK_NUMBER_MAX_LEN} characters.`;
  }
  if (changesFromValues(input.stored, input.values).changed.length === 0) {
    return "Change at least one field.";
  }
  const count = Array.from(input.reason.trim()).length;
  if (count < input.reasonMin) return `Add a reason (at least ${input.reasonMin} characters).`;
  if (count > input.reasonMax) return `The reason can be at most ${input.reasonMax} characters.`;
  if (input.denied) return "That change can't be saved. See the note above.";
  return null;
}

export type CorrectFailureMode = "close_and_refresh" | "inline" | "retry";

/** Codes the user can fix without losing the form: show them inline, stay open. */
const INLINE_CONFLICT_CODES: ReadonlySet<string> = new Set([
  "would_hide_statement",
  "check_number_present",
]);

/**
 * How the dialog reacts to a failed POST. Mirrors the Move dialog: 403/404/409
 * mean the row changed or the caller may not (toast, close, refresh); 400 is
 * inline; anything else is a retry. Two 409s the user can fix in place
 * (`would_hide_statement`, `check_number_present`) stay inline so the form
 * survives.
 */
export function correctFailureAction(
  status: number,
  body: Partial<CorrectionErrorBody> | null,
): { mode: CorrectFailureMode; message: string } {
  const message = body?.error || (body?.code ? CORRECTION_ERROR_COPY[body.code] : undefined) || CORRECTION_FAILED_MESSAGE;
  if (status === 409 && body?.code && INLINE_CONFLICT_CODES.has(body.code)) {
    return { mode: "inline", message };
  }
  if (status === 403 || status === 404 || status === 409) {
    return { mode: "close_and_refresh", message };
  }
  if (status === 400) return { mode: "inline", message };
  return { mode: "retry", message: status >= 500 ? CORRECTION_FAILED_MESSAGE : message };
}

/** Success line for the toast and the success phase. */
export function correctSuccessMessage(result: Pick<CorrectResponse, "operation" | "bankAccountName">): string {
  if (result.operation === "fill_bank_account") {
    return `Added to ${result.bankAccountName ?? "the bank account"}. It can now be matched in reconciliation.`;
  }
  return "Correction saved. It is logged with your reason on the Compliance page.";
}

export const BUDGET_LINE_CLEARED_MESSAGE =
  "This entry's budget-line link was cleared because the date or category moved it out of range. Re-select it if it still applies.";

/**
 * What closing does. A close during a request is ignored; the register is
 * refreshed when the dialog closes after a success.
 */
export function resolveCorrectClose(input: {
  nextOpen: boolean;
  phase: "loading" | "load_error" | "blocked" | "form" | "success";
  submitting: boolean;
}): { proceed: boolean; refresh: boolean } {
  if (input.nextOpen) return { proceed: true, refresh: false };
  if (input.submitting) return { proceed: false, refresh: false };
  return { proceed: true, refresh: input.phase === "success" };
}

/** Heading and button copy per mode. */
export const CORRECT_MODE_COPY: Record<
  CorrectMode,
  { title: string; description: string; submit: string; submitting: string; blockedHeading: string }
> = {
  add_bank_account: {
    title: "Add bank account",
    description: "Record which bank account this paid reimbursement came out of.",
    submit: "Add bank account",
    submitting: "Adding…",
    blockedHeading: "A bank account can't be added",
  },
  correct: {
    title: "Correct paid reimbursement",
    description: "Correct this paid reimbursement's entry, with a reason that is logged.",
    submit: "Save correction",
    submitting: "Saving…",
    blockedHeading: "This entry can't be corrected",
  },
};

/**
 * Keep the budget-line pick coherent when the category or date changes: a line
 * that no longer matches the new category, or whose fiscal year the new date
 * leaves, is dropped (the request then sends `budgetLineId: null`, which is what
 * the server's own auto-clear would do). Returns whether it cleared one.
 */
export function applyValuePatch(
  current: CorrectFormValues,
  patch: Partial<CorrectFormValues>,
  budgetLines: readonly { id: string; categoryId: string; fiscalYear: number }[],
  fiscalYearOf: (isoDate: string) => number | null,
): { values: CorrectFormValues; budgetLineCleared: boolean } {
  const next = { ...current, ...patch };
  let budgetLineCleared = false;
  if (
    next.budgetLineId &&
    ("categoryId" in patch || "txnDate" in patch) &&
    !("budgetLineId" in patch)
  ) {
    const line = budgetLines.find((l) => l.id === next.budgetLineId);
    const fy = fiscalYearOf(next.txnDate);
    if (!line || line.categoryId !== next.categoryId || (fy !== null && line.fiscalYear !== fy)) {
      next.budgetLineId = "";
      budgetLineCleared = true;
    }
  }
  return { values: next, budgetLineCleared };
}
