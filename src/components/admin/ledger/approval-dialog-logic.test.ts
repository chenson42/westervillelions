import { describe, it, expect } from "vitest";
import {
  approvalDialogTitle,
  approvalSuccessMessage,
  minuteHelper,
  minuteRequiredMessage,
  rejectPlaceholder,
  APPROVE_HINT,
  GENERIC_CONFLICT_MESSAGE,
  NOT_FOUND_MESSAGE,
  SELF_ROW_MESSAGE,
  approvalFailureAction,
  approveHint,
  rowActions,
  approvalEntryHref,
  cosignRequest,
  cosignFailureAction,
  cosignerItems,
  cosignDialogProps,
  COSIGN_RETRY_MESSAGE,
  COSIGN_NOT_FOUND_MESSAGE,
  describeBatchDecision,
} from "./approval-dialog-logic";
import type { ApprovalConflictBody, DecidedApprovalRow } from "@/lib/ledger-approval";

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
    expect(a.message).toBe("Pat Example already approved this disbursement. You can add your approval too.");
  });
  it("409 approved-by-other with the reject verb carries no co-sign suffix", () => {
    const a = approvalFailureAction(409, conflict(), "reject");
    expect(a.message).toBe("Pat Example already approved this disbursement.");
    expect(a.message).not.toContain("add your approval");
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
        showEntry: false,
        toastKind: "info",
        message: GENERIC_CONFLICT_MESSAGE,
      });
    }
  });
  it("404 closes and refreshes", () => {
    expect(approvalFailureAction(404, { code: "not_found", error: "x" }, "approve")).toEqual({
      close: true,
      refresh: true,
      showEntry: false,
      toastKind: "error",
      message: NOT_FOUND_MESSAGE,
    });
  });
  it("400, 403 and 500 keep the dialog open and carry the server's error", () => {
    for (const status of [400, 403, 500]) {
      expect(approvalFailureAction(status, { error: "Nope" }, "approve")).toEqual({
        close: false,
        refresh: false,
        showEntry: false,
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
      showEntry: false,
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

describe("noun-correct dialog copy", () => {
  const nouns = ["disbursement", "transfer", "sweep"] as const;
  it("titles and success messages per noun and verb", () => {
    expect(approvalDialogTitle("approve", "sweep")).toBe("Approve Sweep");
    expect(approvalDialogTitle("reject", "transfer")).toBe("Reject Transfer");
    expect(approvalDialogTitle("approve", "disbursement")).toBe("Approve Disbursement");
    expect(approvalSuccessMessage("approve", "sweep")).toBe("Sweep approved.");
    expect(approvalSuccessMessage("reject", "transfer")).toBe("Transfer rejected.");
    expect(approvalSuccessMessage("approve", "disbursement")).toBe("Disbursement approved.");
  });
  it("placeholder, helper and required message use the noun", () => {
    expect(rejectPlaceholder("sweep")).toBe("Explain why this sweep is being rejected…");
    expect(minuteHelper("transfer")).toBe(
      "Enter the board-meeting minute or motion reference that authorized this transfer.",
    );
    expect(minuteRequiredMessage("sweep")).toBe("A board-minute reference is required to approve a sweep.");
  });
  it("no transfer or sweep string says disbursement, and the fallback uses the noun", () => {
    for (const noun of ["transfer", "sweep"] as const) {
      const all = [
        approvalDialogTitle("approve", noun), approvalDialogTitle("reject", noun),
        approvalSuccessMessage("approve", noun), approvalSuccessMessage("reject", noun),
        rejectPlaceholder(noun), minuteHelper(noun), minuteRequiredMessage(noun),
        approvalFailureAction(500, null, "approve", noun).message,
      ];
      for (const s of all) expect(s.toLowerCase()).not.toContain("disbursement");
    }
    expect(nouns).toHaveLength(3);
  });
});

describe("showEntry (lost the approve race)", () => {
  it("is true only for approve + approved by someone else", () => {
    const a = approvalFailureAction(409, conflict(), "approve");
    expect(a.showEntry).toBe(true);
    expect(a.message.endsWith("You can add your approval too.")).toBe(true);
    expect(approvalFailureAction(409, conflict(), "reject").showEntry).toBe(false);
    expect(approvalFailureAction(409, conflict({ decidedByViewer: true }), "approve").showEntry).toBe(false);
    expect(approvalFailureAction(409, conflict({ decision: "rejected" }), "approve").showEntry).toBe(false);
    expect(approvalFailureAction(409, conflict({ decision: null }), "approve").showEntry).toBe(false);
    expect(approvalFailureAction(404, null, "approve").showEntry).toBe(false);
    expect(approvalFailureAction(500, null, "approve").showEntry).toBe(false);
  });
});

describe("approvalEntryHref", () => {
  it("builds the ?txn= deep link and encodes the id", () => {
    expect(approvalEntryHref("00000000-0000-4000-8000-000000000001")).toBe(
      "/admin/ledger/approvals?txn=00000000-0000-4000-8000-000000000001",
    );
    expect(approvalEntryHref("a&b/c")).toBe("/admin/ledger/approvals?txn=a%26b%2Fc");
  });
});

describe("cosignRequest", () => {
  it("is a bodiless POST with no Content-Type", () => {
    const { url, init } = cosignRequest("abc");
    expect(url).toBe("/api/admin/ledger/transactions/abc/cosign");
    expect(init.method).toBe("POST");
    expect(init).not.toHaveProperty("body");
    expect(init).not.toHaveProperty("headers");
  });
});

describe("cosignFailureAction", () => {
  const c = (code: string, over: Record<string, unknown> = {}) => ({
    error: "x",
    code,
    at: null,
    deciderName: null,
    ...over,
  });
  const AT = "2026-10-10T19:42:00.000Z";
  const closed = { close: true, refresh: true, toastKind: "info" };

  it("already_cosigned is success-shaped, with or without a date", () => {
    expect(cosignFailureAction(409, c("already_cosigned", { at: AT }))).toEqual({
      ...closed,
      message: "You already added your approval on Oct 10, 2026 at 3:42 PM.",
    });
    expect(cosignFailureAction(409, c("already_cosigned")).message).toBe("You already added your approval.");
  });
  it("already_approved, not_approved, not_board_decision", () => {
    expect(cosignFailureAction(409, c("already_approved", { at: AT }))).toEqual({
      ...closed,
      message: "You approved this on Oct 10, 2026 at 3:42 PM.",
    });
    expect(cosignFailureAction(409, c("already_approved")).message).toBe("You approved this.");
    expect(cosignFailureAction(409, c("not_approved"))).toEqual({
      ...closed,
      message: "This entry is still waiting for its first approval.",
    });
    expect(cosignFailureAction(409, c("not_board_decision"))).toEqual({
      ...closed,
      message: "This entry did not need board approval.",
    });
  });
  it("rejected names the rejector, falls back to A board member, omits a null date", () => {
    expect(cosignFailureAction(409, c("rejected", { at: AT, deciderName: "Lee Example" }), "sweep").message).toBe(
      "Lee Example rejected this sweep on Oct 10, 2026 at 3:42 PM, so it cannot take more approvals.",
    );
    expect(cosignFailureAction(409, c("rejected")).message).toBe(
      "A board member rejected this disbursement, so it cannot take more approvals.",
    );
    expect(cosignFailureAction(409, c("rejected", { deciderName: "a@b.example" })).message).toContain(
      "A board member",
    );
  });
  it("403 recorded_by_you closes; a permission 403 keeps the dialog open", () => {
    expect(cosignFailureAction(403, { error: "x", code: "recorded_by_you" })).toEqual({
      ...closed,
      message: "You recorded this entry, so another board member needs to approve it.",
    });
    expect(cosignFailureAction(403, { error: "Forbidden" })).toEqual({
      close: false,
      refresh: false,
      toastKind: "error",
      message: "Forbidden",
    });
  });
  it("404 closes and refreshes with an error toast", () => {
    expect(cosignFailureAction(404, { code: "not_found", error: "x" })).toEqual({
      close: true,
      refresh: true,
      toastKind: "error",
      message: COSIGN_NOT_FOUND_MESSAGE,
    });
  });
  it("400, 5xx and network failure keep the dialog open", () => {
    expect(cosignFailureAction(500, { error: "Failed to add your approval" })).toEqual({
      close: false,
      refresh: false,
      toastKind: "error",
      message: "Failed to add your approval",
    });
    expect(cosignFailureAction(400, null).message).toBe(COSIGN_RETRY_MESSAGE);
    expect(cosignFailureAction(null, { error: "Failed to fetch" })).toEqual({
      close: false,
      refresh: false,
      toastKind: "error",
      message: COSIGN_RETRY_MESSAGE,
    });
  });
  it("an unrecognised 409 closes and refreshes", () => {
    for (const body of [null, {}, { code: "not_pending", error: "x" }]) {
      const a = cosignFailureAction(409, body);
      expect(a.close).toBe(true);
      expect(a.refresh).toBe(true);
    }
  });
});

describe("cosignerItems", () => {
  const e = (name: string | null, isViewer = false, cosignedAt = "2026-10-11T15:00:00.000Z") => ({
    name,
    isViewer,
    cosignedAt,
  });
  it("is empty with no co-signers", () => {
    expect(cosignerItems([])).toEqual([]);
  });
  it("lists names with short dates in order, the viewer as You", () => {
    expect(cosignerItems([e("Ann Example"), e("Bo Example", true, "2026-10-12T15:00:00.000Z")])).toEqual([
      "Ann Example (Oct 11)",
      "You (Oct 12)",
    ]);
  });
  it("collapses unnamed and email-shaped names", () => {
    expect(cosignerItems([e(null)])).toEqual(["a board member"]);
    expect(cosignerItems([e(null), e("x@y.example")])).toEqual(["2 board members"]);
    expect(cosignerItems([e("Ann Example"), e(null), e(null)])).toEqual([
      "Ann Example (Oct 11)",
      "2 other board members",
    ]);
  });
  it("never renders an email, a fraction or votes", () => {
    const text = cosignerItems([e("Ann Example"), e("a@b.example")]).join(" ");
    expect(text).not.toMatch(/@|votes|\bof \d/);
  });
});

describe("cosignDialogProps", () => {
  it("maps the embedded row to the dialog strings with no user ids", () => {
    const row = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "sweep",
      decision: "approved",
      party: null,
      memo: "m",
      fundName: "Charitable Fund",
      partnerFundName: "Activity Fund",
      entityId: "e2",
      partnerEntityId: "e1",
      entityName: "Foundation",
      partnerEntityName: "Club",
      recorderName: "Sam Example",
      boardMinute: "Minute 4",
    } as unknown as Extract<DecidedApprovalRow, { decision: "approved" }>;
    const p = cosignDialogProps(row, "$5.00");
    expect(p).toEqual({
      transactionId: row.id,
      amountText: "$5.00",
      party: "",
      noun: "sweep",
      fundText: "Charitable Fund (Foundation) → Activity Fund (Club)",
      memo: "m",
      recorderName: "Sam Example",
      boardMinute: "Minute 4",
    });
  });
});

describe("itemized sweep batches (B-172 Inc 2b, B8)", () => {
  it("describeBatchDecision says one decision covers the whole batch, by verb and count", () => {
    const approve = describeBatchDecision("approve", 12);
    expect(approve).toContain("This decides the whole batch of 12 gifts");
    expect(approve).toContain("individual gifts cannot be decided separately");
    expect(approve).toContain("Approving posts all of them");
    const reject = describeBatchDecision("reject", 12);
    expect(reject).toContain("whole batch of 12 gifts");
    expect(reject).toContain("Rejecting frees all of them to be swept again");
    expect(reject).not.toContain("Approving");
  });

  it("describeBatchDecision uses the singular for one gift", () => {
    expect(describeBatchDecision("approve", 1)).toContain("whole batch of 1 gift;");
    expect(describeBatchDecision("approve", 1)).not.toContain("1 gifts");
  });

  it("approvalFailureAction consumes a 400 decide_the_batch: closes, refreshes, says what the server said", () => {
    const body = { error: "A sweep batch is decided from its transfer entry.", code: "decide_the_batch" };
    for (const verb of ["approve", "reject"] as const) {
      expect(approvalFailureAction(400, body, verb, "sweep")).toEqual({
        close: true,
        refresh: true,
        showEntry: false,
        toastKind: "error",
        message: body.error,
      });
    }
  });

  it("a 400 that is not decide_the_batch still keeps the dialog open", () => {
    const r = approvalFailureAction(400, { error: "Board minute is required." }, "approve", "sweep");
    expect(r.close).toBe(false);
    expect(r.message).toBe("Board minute is required.");
  });
});
