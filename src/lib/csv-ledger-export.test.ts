/**
 * Unit tests for csvCellSafe() — ledger CSV export injection guard.
 *
 * DECISION-023: csvCellSafe() extends standard CSV quoting with a leading-
 * character injection guard. If the first char of the cell value is '=', '+',
 * '-', or '@', a literal tab (\t) is prepended before any quoting step.
 *
 * The function is exported from the ledger export route for testability.
 */

import { describe, it, expect } from "vitest";
import { csvCellSafe } from "@/lib/csv-safe";

describe("csvCellSafe", () => {
  // -------------------------------------------------------------------------
  // Injection-guard cases (DECISION-023 requirement: one test per formula char)
  // -------------------------------------------------------------------------

  it("prepends tab when value starts with '='", () => {
    // A cell starting with '=' would be interpreted as a formula in Excel/Sheets
    expect(csvCellSafe("=SUM(A1:A10)")).toBe("\t=SUM(A1:A10)");
  });

  it("prepends tab when value starts with '+'", () => {
    expect(csvCellSafe("+1234")).toBe("\t+1234");
  });

  it("prepends tab when value starts with '-'", () => {
    expect(csvCellSafe("-1234")).toBe("\t-1234");
  });

  it("prepends tab when value starts with '@'", () => {
    expect(csvCellSafe("@SUM(A1)")).toBe("\t@SUM(A1)");
  });

  // -------------------------------------------------------------------------
  // Standard CSV quoting cases
  // -------------------------------------------------------------------------

  it("returns plain string unchanged when it contains no special chars", () => {
    expect(csvCellSafe("Westerville Lions Club")).toBe("Westerville Lions Club");
  });

  it("wraps in double-quotes when value contains a comma", () => {
    expect(csvCellSafe("Smith, John")).toBe('"Smith, John"');
  });

  it("wraps in double-quotes and escapes internal quotes", () => {
    // A memo containing a double-quote character
    expect(csvCellSafe('Say "hello"')).toBe('"Say ""hello"""');
  });

  // -------------------------------------------------------------------------
  // Null / empty cases
  // -------------------------------------------------------------------------

  it("returns empty string for null", () => {
    expect(csvCellSafe(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(csvCellSafe(undefined)).toBe("");
  });

  // -------------------------------------------------------------------------
  // Combined: injection guard + quoting
  // -------------------------------------------------------------------------

  it("prepends tab AND wraps in quotes when formula-starting value also contains a comma", () => {
    // e.g. a payee name like "=HYPERLINK(url,label)"
    // After tab prepend the string becomes "\t=HYPERLINK(url,label)" — contains comma
    expect(csvCellSafe("=HYPERLINK(url,label)")).toBe('"\t=HYPERLINK(url,label)"');
  });

  // -------------------------------------------------------------------------
  // Edge: numeric values (coerced to string)
  // -------------------------------------------------------------------------

  it("coerces numbers to string and applies no guard (numbers are safe)", () => {
    expect(csvCellSafe(12345)).toBe("12345");
  });

  it("coerces boolean to string", () => {
    expect(csvCellSafe(true)).toBe("true");
  });
});
