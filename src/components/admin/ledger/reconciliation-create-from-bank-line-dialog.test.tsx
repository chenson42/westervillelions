/**
 * T41: the duplicate guard in the create-from-bank-line dialog (B-108 /
 * DECISION-114). Node env: the advisory renders statically; the gating and the
 * request flag are pure rules; the dialog's source is pinned for the wiring.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DuplicatePaymentAdvisory from "./duplicate-payment-advisory";
import {
  OWN_REQUEST_REASON,
  acknowledgeFlag,
  hasDuplicateCandidates,
  isCreateBlockedByDuplicate,
  offerInsteadAction,
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

const noop = () => {};
function advisory(candidates: CreateFromBankLineCandidate[], acknowledged = false) {
  return renderToStaticMarkup(
    <DuplicatePaymentAdvisory
      candidates={candidates}
      acknowledged={acknowledged}
      onAcknowledgedChange={noop}
      onUseCandidate={noop}
    />,
  );
}
const DISABLED = /\sdisabled=""/;

describe("DuplicatePaymentAdvisory", () => {
  it("renders the warning with the amount, date and payee", () => {
    const html = advisory([cand()]);
    expect(html).toContain("A paid reimbursement of $25.00");
    expect(html).toContain("Sep 30, 2026");
    expect(html).toContain("to Pat Member");
    expect(html).toContain("Creating a new entry would count it twice.");
    expect(html).toContain('role="alert"');
  });

  it("says when the check numbers match", () => {
    expect(advisory([cand({ checkNumberMatchesLine: true })])).toContain("Check numbers match.");
    expect(advisory([cand()])).not.toContain("Check numbers match.");
  });

  it("offers Use that entry instead, enabled for someone else's request", () => {
    const html = advisory([cand()]);
    const m = /<button([^>]*)>Use that entry instead<\/button>/.exec(html);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(DISABLED);
  });

  it("disables Use that entry instead with the reason on the viewer's own request", () => {
    const html = advisory([cand({ ownRequest: true })]);
    const m = /<button([^>]*)>Use that entry instead<\/button>/.exec(html);
    expect(m![1]).toMatch(DISABLED);
    expect(html).toContain(OWN_REQUEST_REASON);
  });

  it("has the 'different payment' checkbox, unchecked until ticked", () => {
    expect(advisory([cand()])).toContain("This is a different payment");
    expect(advisory([cand()])).not.toContain("checked");
    expect(advisory([cand()], true)).toContain("checked");
  });
});

describe("duplicate gating", () => {
  const one = [cand()];
  it("Create & Match is blocked until the box is ticked, only for an expense with candidates", () => {
    expect(isCreateBlockedByDuplicate({ flow: "expense", candidates: one, acknowledged: false })).toBe(true);
    expect(isCreateBlockedByDuplicate({ flow: "expense", candidates: one, acknowledged: true })).toBe(false);
    expect(isCreateBlockedByDuplicate({ flow: "expense", candidates: [], acknowledged: false })).toBe(false);
    expect(isCreateBlockedByDuplicate({ flow: "income", candidates: one, acknowledged: false })).toBe(false);
    expect(hasDuplicateCandidates("income", one)).toBe(false);
  });

  it("the request carries acknowledgeDuplicate only after the box is ticked", () => {
    expect(acknowledgeFlag({ flow: "expense", candidates: one, acknowledged: false })).toEqual({});
    expect(acknowledgeFlag({ flow: "expense", candidates: one, acknowledged: true })).toEqual({ acknowledgeDuplicate: true });
    // No candidates: nothing to acknowledge, so the flag is never sent.
    expect(acknowledgeFlag({ flow: "expense", candidates: [], acknowledged: true })).toEqual({});
  });

  it("Use that entry instead repairs a needs-bank-account candidate and otherwise goes to matching", () => {
    expect(offerInsteadAction(cand({ needsBankAccount: true }))).toEqual({ kind: "repair", disabledReason: null });
    expect(offerInsteadAction(cand({ needsBankAccount: false }))).toEqual({ kind: "match", disabledReason: null });
    expect(offerInsteadAction(cand({ ownRequest: true })).disabledReason).toBe(OWN_REQUEST_REASON);
  });
});

describe("dialog wiring", () => {
  const dialog = readFileSync(join(__dirname, "reconciliation-create-from-bank-line-dialog.tsx"), "utf8");
  const grid = readFileSync(join(__dirname, "reconciliation-matching-grid.tsx"), "utf8");

  it("the dialog uses the shared limit, the advisory, the flag and the stale-409 path", () => {
    expect(dialog).toContain("maxLength={CHECK_NUMBER_MAX_LEN}");
    expect(dialog).not.toMatch(/maxLength=\{20\}/);
    expect(dialog).toContain("<DuplicatePaymentAdvisory");
    expect(dialog).toContain("...acknowledgeFlag(");
    expect(dialog).toContain('data?.code === "possible_duplicate"');
    expect(dialog).toContain("isCreateBlockedByDuplicate(");
  });

  it("the grid opens the repair dialog with the session account preselected", () => {
    expect(grid).toContain("preselectBankAccountId={bankAccountId}");
    expect(grid).toContain("onUseCandidate=");
  });
});
