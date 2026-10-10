import { describe, it, expect } from "vitest";
import {
  APPROVE_HINT,
  GENERIC_CONFLICT_MESSAGE,
  NOT_FOUND_MESSAGE,
  SELF_ROW_MESSAGE,
  approvalFailureAction,
  approveHint,
  rowActions,
} from "./approval-dialog-logic";
import type { ApprovalConflictBody } from "@/lib/ledger-approval";

const conflict = (over: Partial<ApprovalConflictBody> = {}): ApprovalConflictBody => ({
  error: "Transaction is no longer pending",
  code: "not_pending",
  decision: "approved",
  deciderName: "Pat Example",
  decidedAt: "2026-10-10T15:42:00.000Z",
  decidedByViewer: false,
  ...over,
});

describe("rowActions", () => {
  it("offers neither Approve nor Reject on a row the viewer recorded", () => {
    expect(rowActions(true)).toEqual({ approve: false, reject: false, selfMessage: SELF_ROW_MESSAGE });
  });
  it("offers both on someone else's row", () => {
    expect(rowActions(false)).toEqual({ approve: true, reject: true, selfMessage: null });
  });
});

describe("approvalFailureAction", () => {
  it("409 with a typed body closes, refreshes and names the decider", () => {
    const a = approvalFailureAction(409, conflict(), "approve");
    expect(a).toMatchObject({ close: true, refresh: true, toastKind: "info" });
    expect(a.message).toBe("Pat Example already approved this disbursement. Only one approval is needed.");
  });
  it("409 uses 'A board member' for a null name and 'You' for the viewer", () => {
    expect(approvalFailureAction(409, conflict({ deciderName: null }), "reject").message).toContain(
      "A board member already approved",
    );
    expect(approvalFailureAction(409, conflict({ decidedByViewer: true }), "approve").message).toBe(
      "You already approved this disbursement.",
    );
  });
  it("409 for a rejected entry and for the noun", () => {
    expect(
      approvalFailureAction(409, conflict({ decision: "rejected", deciderName: null }), "approve", "sweep").message,
    ).toBe("A board member already rejected this sweep.");
  });
  it("409 with an unrecognized body still closes and refreshes with the generic line", () => {
    for (const body of [null, {}, { error: "x" }, { code: "other", error: "x" }, "oops"]) {
      expect(approvalFailureAction(409, body, "approve")).toEqual({
        close: true,
        refresh: true,
        toastKind: "info",
        message: GENERIC_CONFLICT_MESSAGE,
      });
    }
  });
  it("404 closes and refreshes", () => {
    expect(approvalFailureAction(404, { code: "not_found", error: "x" }, "approve")).toEqual({
      close: true,
      refresh: true,
      toastKind: "error",
      message: NOT_FOUND_MESSAGE,
    });
  });
  it("400, 403 and 500 keep the dialog open and carry the server's error", () => {
    for (const status of [400, 403, 500]) {
      expect(approvalFailureAction(status, { error: "Nope" }, "approve")).toEqual({
        close: false,
        refresh: false,
        toastKind: "error",
        message: "Nope",
      });
    }
  });
  it("a server failure with no readable error uses the fixed generic line", () => {
    expect(approvalFailureAction(500, null, "reject").message).toBe(
      "Could not reject disbursement. Please try again.",
    );
  });
  it("a network failure keeps the dialog open with the fixed generic message", () => {
    expect(approvalFailureAction(null, { error: "Failed to fetch" }, "approve")).toEqual({
      close: false,
      refresh: false,
      toastKind: "error",
      message: "Could not approve disbursement. Please try again.",
    });
  });
});

describe("approveHint", () => {
  it("shows when there is no minute and none pre-filled", () => {
    expect(approveHint("", null)).toBe(APPROVE_HINT);
    expect(approveHint("   ", undefined)).toBe(APPROVE_HINT);
  });
  it("hides when a minute is typed", () => {
    expect(approveHint("Motion 4", null)).toBeNull();
  });
  it("hides when the row already cites a minute", () => {
    expect(approveHint("", "Sweep motion")).toBeNull();
  });
});
