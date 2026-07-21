import { describe, it, expect } from "vitest";
import { parseCheckNumberFromMemo, classifyRegisterCheckColumn } from "./check-number";

describe("parseCheckNumberFromMemo", () => {
  it("happy path, 'check #' phrasing", () => {
    expect(parseCheckNumberFromMemo("Check #8249 for the roof")).toEqual({
      checkNumber: "8249",
      ambiguous: false,
    });
  });

  it("happy path, bare hash", () => {
    expect(parseCheckNumberFromMemo("Payment - #1234")).toEqual({
      checkNumber: "1234",
      ambiguous: false,
    });
  });

  it("ambiguous, real data example: memo references a DIFFERENT check than its own row", () => {
    // This exact memo appears in the real Quicken register on a row whose own
    // check number is 8049 — the memo's "#8045" belongs to a different check
    // entirely. This is why parseCheckNumberFromMemo must never be trusted as
    // ground truth for the row it was extracted from (DECISION-034).
    expect(parseCheckNumberFromMemo("Replacement for check #8045")).toEqual({
      checkNumber: "8045",
      ambiguous: true,
    });
  });

  it("ambiguous, multiple candidates", () => {
    const result = parseCheckNumberFromMemo("Voided check #8045, reissued as #8049");
    expect(result).not.toBeNull();
    expect(result?.ambiguous).toBe(true);
  });

  it("no match", () => {
    expect(parseCheckNumberFromMemo("Meeting hospitality")).toBeNull();
  });

  it("no match, empty/null input", () => {
    expect(parseCheckNumberFromMemo("")).toBeNull();
    expect(parseCheckNumberFromMemo(null)).toBeNull();
  });
});

describe("classifyRegisterCheckColumn", () => {
  it("numeric column, action='Check'", () => {
    expect(classifyRegisterCheckColumn("Check", "8249")).toEqual({
      checkNumber: "8249",
    });
  });

  it("non-numeric marker, action='Check'", () => {
    expect(classifyRegisterCheckColumn("Check", "Card")).toEqual({
      checkNumber: null,
      flag: "non_numeric_check_column",
      rawValue: "Card",
    });
  });

  it("non-numeric marker, blank field, action='Check'", () => {
    expect(classifyRegisterCheckColumn("Check", "")).toEqual({
      checkNumber: null,
    });
  });

  it("action !== 'Check' — always null, no flag, regardless of the Check # field", () => {
    expect(classifyRegisterCheckColumn("DEP", "8249")).toEqual({ checkNumber: null });
    expect(classifyRegisterCheckColumn("Teller", "Card")).toEqual({ checkNumber: null });
  });
});
