/** T45: the Treasury Guide covers Correct, the bank-account and check-number fields, and the duplicate warning. */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BooksRegisterSection from "./books-register-section";
import ReimbursementsSection from "./reimbursements-section";
import ReconciliationSection from "./reconciliation-section";

const text = (el: React.ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");

describe("guide: books & register", () => {
  const t = text(<BooksRegisterSection />);
  it("explains Correct, Add bank account, the locks, the tier and the own-request rule", () => {
    expect(t).toContain("Correcting a paid reimbursement");
    expect(t).toContain("Paid reimbursement");
    expect(t).toContain("Correct");
    expect(t).toContain("Add bank account");
    expect(t).toContain("check number");
    expect(t).toContain("unmatch it, correct it, then match it again");
    expect(t).toContain("Manage Ledger permission");
    expect(t).toContain("cannot correct a reimbursement you submitted");
  });
  it("still documents Move", () => {
    expect(t).toContain("Moving an entry to another fund");
  });
});

describe("guide: reimbursements", () => {
  const t = text(<ReimbursementsSection />);
  it("covers the bank account, check number, Register description and the Paid-tab badge", () => {
    expect(t).toContain("which bank account the money came out of");
    expect(t).toContain("check number");
    expect(t).toContain("Register description");
    expect(t).toContain("Needs bank account");
    expect(t).toContain("Add bank account");
  });
});

describe("guide: reconciliation", () => {
  const t = text(<ReconciliationSection />);
  it("covers the duplicate warning, Use that entry instead, the picker hint and the closed-period unwind", () => {
    expect(t).toContain("Use that entry instead");
    expect(t).toContain("This is a different payment");
    expect(t).toContain("record the payment twice");
    expect(t).toContain("has no bank account");
    expect(t).toContain("reopen the session");
  });
});
