import { describe, it, expect } from "vitest";
import {
  describeApprovalConflict,
  describeApprovalFund,
  displayDeciderName,
  isApprovalConflict,
  type ApprovalConflictBody,
} from "./ledger-approval";

const base: ApprovalConflictBody = {
  error: "Transaction is no longer pending",
  code: "not_pending",
  decision: "approved",
  deciderName: "Pat Example",
  decidedAt: "2026-10-10T15:42:00.000Z",
  decidedByViewer: false,
};

describe("describeApprovalFund", () => {
  it("treats a same-entity pair as a Transfer", () => {
    expect(
      describeApprovalFund({ fundName: "Admin Fund", partnerFundName: "Activity Fund", entityId: "e1", partnerEntityId: "e1" }),
    ).toEqual({ kind: "transfer", text: "Admin Fund → Activity Fund" });
  });
  it("treats a cross-entity pair as a Sweep", () => {
    expect(
      describeApprovalFund({ fundName: "Activity Fund", partnerFundName: "Charitable Fund", entityId: "e1", partnerEntityId: "e2" }).kind,
    ).toBe("sweep");
  });
  it("returns plain for a row with no partner", () => {
    expect(
      describeApprovalFund({ fundName: "Admin Fund", partnerFundName: null, entityId: "e1", partnerEntityId: null }),
    ).toEqual({ kind: "plain", text: "Admin Fund" });
  });
  it("reads a null fund name as Unknown Fund", () => {
    expect(
      describeApprovalFund({ fundName: null, partnerFundName: null, entityId: "e1", partnerEntityId: null }).text,
    ).toBe("Unknown Fund");
    expect(
      describeApprovalFund({ fundName: null, partnerFundName: "B", entityId: "e1", partnerEntityId: "e1" }).text,
    ).toBe("Unknown Fund → B");
  });
});

describe("displayDeciderName", () => {
  it("returns null for null, empty and blank", () => {
    expect(displayDeciderName(null)).toBeNull();
    expect(displayDeciderName(undefined)).toBeNull();
    expect(displayDeciderName("")).toBeNull();
    expect(displayDeciderName("   ")).toBeNull();
  });
  it("returns null for a value containing @", () => {
    expect(displayDeciderName("someone@example.com")).toBeNull();
  });
  it("returns an ordinary name trimmed", () => {
    expect(displayDeciderName("  Pat Example ")).toBe("Pat Example");
  });
});

describe("describeApprovalConflict", () => {
  it("approved by someone else", () => {
    expect(describeApprovalConflict(base, "disbursement")).toBe(
      "Pat Example already approved this disbursement. Only one approval is needed.",
    );
  });
  it("approved by the viewer", () => {
    expect(describeApprovalConflict({ ...base, decidedByViewer: true }, "sweep")).toBe(
      "You already approved this sweep.",
    );
  });
  it("rejected", () => {
    expect(describeApprovalConflict({ ...base, decision: "rejected" }, "transfer")).toBe(
      "Pat Example already rejected this transfer.",
    );
    expect(describeApprovalConflict({ ...base, decision: "rejected", decidedByViewer: true }, "transfer")).toBe(
      "Pat Example already rejected this transfer.",
    );
  });
  it("no decision", () => {
    expect(describeApprovalConflict({ ...base, decision: null, deciderName: null }, "disbursement")).toBe(
      "This disbursement is no longer waiting for approval.",
    );
  });
  it("a null name reads A board member", () => {
    expect(describeApprovalConflict({ ...base, deciderName: null }, "disbursement")).toBe(
      "A board member already approved this disbursement. Only one approval is needed.",
    );
  });
  it("never outputs an @", () => {
    const outs = [
      describeApprovalConflict({ ...base, deciderName: "a@example.com" }, "disbursement"),
      describeApprovalConflict({ ...base, decision: "rejected", deciderName: "a@example.com" }, "sweep"),
      describeApprovalConflict({ ...base, decision: null, deciderName: "a@example.com" }, "transfer"),
    ];
    for (const o of outs) expect(o).not.toContain("@");
    expect(outs[0]).toContain("A board member");
  });
});

describe("isApprovalConflict", () => {
  it("accepts a full body", () => {
    expect(isApprovalConflict(base)).toBe(true);
  });
  it("rejects missing code, different code, or non-object", () => {
    expect(isApprovalConflict({ error: "x" })).toBe(false);
    expect(isApprovalConflict({ error: "x", code: "not_found" })).toBe(false);
    expect(isApprovalConflict({ code: "not_pending" })).toBe(false);
    expect(isApprovalConflict(null)).toBe(false);
    expect(isApprovalConflict("not_pending")).toBe(false);
  });
});
