/**
 * Check-number helpers — pure functions, no DB/Next.js import (mirrors the
 * ledger.ts pure-function-layer convention).
 *
 * Bank Reconciliation inc1 (T-18, DECISION-034). Two functions:
 *
 * - `classifyRegisterCheckColumn()` is the PRIMARY backfill classifier: given
 *   a Quicken register row's "Action" and "Check #" column values, it says
 *   whether that row's check number is a clean numeric value, genuinely
 *   absent, or a marker anomaly (e.g. "Card") that means the row is not
 *   actually a paper check despite `Action === "Check"`.
 * - `parseCheckNumberFromMemo()` is a DEMOTED, low-confidence enrichment hint
 *   used only when the primary CSV-replay match fails to locate a
 *   corresponding ledger_transactions row. Real data showed memo text almost
 *   never carries a trustworthy check number for its OWN row — see the
 *   "Replacement for check #8045" test case, where the memo's number belongs
 *   to a *different* check (8049) than the row it's written on.
 */

export type ParsedMemoCheckNumber = {
  checkNumber: string;
  ambiguous: boolean;
};

const REISSUE_LANGUAGE = /\b(replacement|reissue|reissued|void|voided|cancel|cancelled)\b/i;
const NUMBER_TOKEN = /(?:check\s*#?\s*|#)(\d{3,6})/gi;

/**
 * Looks for a "check # NNN" / bare "#NNN" token (3-6 digits) in free-text
 * memo/party content. Returns `null` when nothing matches. Sets
 * `ambiguous: true` when:
 *   - the surrounding text contains reissue/void language ("replacement",
 *     "reissue", "void", "cancel"), or
 *   - more than one distinct number-bearing token is present.
 * In both ambiguous cases the caller must treat the result as a hint only,
 * never as ground truth for the row it was extracted from.
 */
export function parseCheckNumberFromMemo(
  text: string | null | undefined,
): ParsedMemoCheckNumber | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const matches = Array.from(trimmed.matchAll(NUMBER_TOKEN)).map((m) => m[1]);
  if (matches.length === 0) return null;

  const distinct = Array.from(new Set(matches));
  const hasReissueLanguage = REISSUE_LANGUAGE.test(trimmed);
  const ambiguous = hasReissueLanguage || distinct.length > 1;

  return { checkNumber: distinct[0], ambiguous };
}

export type ClassifiedRegisterCheckColumn = {
  checkNumber: string | null;
  flag?: "non_numeric_check_column";
  rawValue?: string;
};

const NUMERIC_CHECK_NUM = /^\d+$/;

/**
 * The PRIMARY backfill classifier: given a register row's `Action` and
 * `Check #` column values, returns the numeric check number when the column
 * is purely digits, or a flagged `null` result when `action === "Check"` but
 * the column holds a non-numeric marker ("Card", "DEP", or anything else
 * non-blank/non-numeric) — this is how the backfill script detects rows that
 * are mistagged `paymentMethod='check'` but are actually something else
 * (e.g. a debit-card purchase) without ever guessing.
 */
export function classifyRegisterCheckColumn(
  action: string,
  checkNumField: string,
): ClassifiedRegisterCheckColumn {
  const trimmedAction = action.trim();
  const trimmedField = checkNumField.trim();

  if (trimmedAction !== "Check") {
    return { checkNumber: null };
  }

  if (trimmedField === "") {
    return { checkNumber: null };
  }

  if (NUMERIC_CHECK_NUM.test(trimmedField)) {
    return { checkNumber: trimmedField };
  }

  return {
    checkNumber: null,
    flag: "non_numeric_check_column",
    rawValue: trimmedField,
  };
}
