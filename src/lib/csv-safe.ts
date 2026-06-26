/**
 * CSV injection-safe cell escaping (DECISION-023).
 *
 * Extracted to a standalone module so it can be unit-tested without pulling in
 * Next.js / next-auth route-file dependencies.
 *
 * Apply to every free-text column in the ledger CSV export (Category, Party/Payee,
 * Memo in the transaction CSV; Line/Group label in the 990-prep CSV).
 *
 * Steps:
 *   1. Coerce to string; empty string for null/undefined.
 *   2. If the first character is '=', '+', '-', or '@', prepend '\t' (a literal
 *      tab) — standard OWASP defence against spreadsheet formula injection.
 *   3. If the resulting string contains ',', '"', '\n', or '\r', wrap in
 *      double-quotes and escape internal '"' as '""'.
 *   4. Otherwise return as-is.
 */
export function csvCellSafe(value: string | number | boolean | null | undefined): string {
  const str = value == null ? "" : String(value);
  // Step 2: injection guard — prepend tab if the first char is a formula trigger
  const guarded =
    str.length > 0 && ["=", "+", "-", "@"].includes(str[0]) ? "\t" + str : str;
  // Step 3: standard CSV quoting
  if (
    guarded.includes(",") ||
    guarded.includes('"') ||
    guarded.includes("\n") ||
    guarded.includes("\r")
  ) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}
