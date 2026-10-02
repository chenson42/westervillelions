/** T42: the match picker's initialQuery and discoverability hint (B-108 / DECISION-114). */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pickerHintCandidate,
  pickerHintText,
  pickerNeedsHintLookup,
} from "./create-from-bank-line-logic";
import type { CreateFromBankLineCandidate } from "@/lib/ledger-reimbursement-correction";

function cand(over: Partial<CreateFromBankLineCandidate> = {}): CreateFromBankLineCandidate {
  return {
    transactionId: "b0000000-0000-4000-8000-000000000001",
    txnDate: "2026-09-30",
    party: "Pat Member",
    amountCents: 2500,
    fundName: "Administrative Fund",
    bankAccountId: null,
    bankAccountName: null,
    checkNumber: null,
    checkNumberMatchesLine: false,
    needsBankAccount: true,
    ownRequest: false,
    ...over,
  };
}

describe("match picker hint rules (T42 logic)", () => {
  const line = { amountCents: -2500 };
  it("looks up only for a debit line with no same-amount expense candidate in its list", () => {
    expect(pickerNeedsHintLookup(line, [])).toBe(true);
    expect(pickerNeedsHintLookup(line, [{ flow: "expense", amountCents: 1000 }])).toBe(true);
    expect(pickerNeedsHintLookup(line, [{ flow: "expense", amountCents: 2500 }])).toBe(false);
    // An income row of the same amount is not a same-amount expense candidate.
    expect(pickerNeedsHintLookup(line, [{ flow: "income", amountCents: 2500 }])).toBe(true);
    expect(pickerNeedsHintLookup({ amountCents: 2500 }, [])).toBe(false);
  });

  it("shows the hint only for a candidate that needs a bank account", () => {
    expect(pickerHintCandidate([cand({ needsBankAccount: false })])).toBeNull();
    expect(pickerHintCandidate([cand({ needsBankAccount: false }), cand({ transactionId: "x" })])?.transactionId).toBe("x");
    expect(pickerHintText(cand())).toBe(
      "A paid reimbursement of $25.00 to Pat Member has no bank account, so it is not in this list.",
    );
  });
});

describe("picker wiring", () => {
  const picker = readFileSync(join(__dirname, "reconciliation-match-picker.tsx"), "utf8");
  it("accepts initialQuery and shows the hint with an Add bank account button", () => {
    expect(picker).toContain("initialQuery");
    expect(picker).toContain("useState(initialQuery)");
    expect(picker).toContain("pickerHintText(hintCandidate)");
    expect(picker).toContain("Add bank account");
  });

  it("looks the hint up only when the list has no same-amount candidate", () => {
    expect(picker).toContain("pickerNeedsHintLookup(bankLine, candidateTransactions)");
  });
});
