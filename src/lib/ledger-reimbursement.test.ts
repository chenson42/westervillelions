/**
 * Unit tests for the reimbursement helpers in src/lib/ledger.ts (DECISION-106).
 * Pure, no DB. Addresses use example.com only.
 */

import { describe, it, expect } from "vitest";
import {
  isOwnReimbursementRequest,
  pickReimbursementNotifyRecipients,
  reimbursementTransactionStamp,
  REIMBURSEMENT_ACTIONABLE_STATUSES,
} from "@/lib/ledger";
import type { TreasurerResolution } from "@/lib/board-positions";

describe("REIMBURSEMENT_ACTIONABLE_STATUSES", () => {
  it("is submitted plus legacy approved, never paid or rejected", () => {
    expect([...REIMBURSEMENT_ACTIONABLE_STATUSES]).toEqual(["submitted", "approved"]);
  });
});

describe("isOwnReimbursementRequest", () => {
  const reimb = { submittedByUserId: "u-1", submittedByMemberId: "m-1" };

  it("matches on user id", () => {
    expect(isOwnReimbursementRequest({ id: "u-1", memberId: "m-9" }, reimb)).toBe(true);
  });

  it("matches on member id with a different user id", () => {
    expect(isOwnReimbursementRequest({ id: "u-9", memberId: "m-1" }, reimb)).toBe(true);
  });

  it("matches on user id when the actor has no memberId (the R-1 hole)", () => {
    expect(isOwnReimbursementRequest({ id: "u-1" }, reimb)).toBe(true);
    expect(isOwnReimbursementRequest({ id: "u-1", memberId: null }, reimb)).toBe(true);
  });

  it("is false when neither matches", () => {
    expect(isOwnReimbursementRequest({ id: "u-9", memberId: "m-9" }, reimb)).toBe(false);
  });

  it("is false when both sides are null (null === null must not count)", () => {
    expect(
      isOwnReimbursementRequest(
        { id: "u-9", memberId: null },
        { submittedByUserId: null, submittedByMemberId: null },
      ),
    ).toBe(false);
  });

  it("is false when submitter member id is null and actor member id is null", () => {
    expect(
      isOwnReimbursementRequest(
        { id: "u-9", memberId: null },
        { submittedByUserId: "u-1", submittedByMemberId: null },
      ),
    ).toBe(false);
  });
});

describe("pickReimbursementNotifyRecipients", () => {
  const treasurerOk: TreasurerResolution = {
    ok: true,
    memberId: "m-t",
    firstName: "T",
    lastName: "Reasurer",
    email: "treasurer@example.com",
  };
  const base = {
    recordHolderEmails: ["Treasurer@Example.com", "admin@example.com", "submitter@example.com"],
    submitterEmail: "submitter@example.com",
    submitterMemberId: "m-s",
  };

  it("sends to the treasurer only when they hold ledger.record", () => {
    const r = pickReimbursementNotifyRecipients({ ...base, treasurer: treasurerOk });
    expect(r).toEqual({ recipients: ["Treasurer@Example.com"], reason: "treasurer" });
  });

  it("matches emails case-insensitively and trimmed", () => {
    const r = pickReimbursementNotifyRecipients({
      ...base,
      recordHolderEmails: ["  TREASURER@example.COM  ", "admin@example.com"],
      treasurer: { ...treasurerOk, email: " treasurer@EXAMPLE.com " },
    });
    expect(r.reason).toBe("treasurer");
    expect(r.recipients).toEqual(["TREASURER@example.COM"]);
  });

  it("falls back when the treasurer does not hold ledger.record", () => {
    const r = pickReimbursementNotifyRecipients({
      ...base,
      treasurer: { ...treasurerOk, email: "other@example.com" },
    });
    expect(r.reason).toBe("fallback_treasurer_lacks_record");
    expect(r.recipients).toEqual(["Treasurer@Example.com", "admin@example.com"]);
  });

  it("falls back when the treasurer is the submitter (by member id)", () => {
    const r = pickReimbursementNotifyRecipients({
      ...base,
      submitterMemberId: "m-t",
      treasurer: treasurerOk,
    });
    expect(r.reason).toBe("fallback_submitter_is_treasurer");
    expect(r.recipients).toContain("admin@example.com");
  });

  it.each(["none", "multiple", "no_board_group"] as const)(
    "falls back on resolver reason %s",
    (reason) => {
      const r = pickReimbursementNotifyRecipients({
        ...base,
        treasurer: { ok: false, reason },
      });
      expect(r.reason).toBe(`fallback_resolver_${reason}`);
      expect(r.recipients).toEqual(["Treasurer@Example.com", "admin@example.com"]);
    },
  );

  it("removes the submitter from holders case-insensitively", () => {
    const r = pickReimbursementNotifyRecipients({
      ...base,
      submitterEmail: "  ADMIN@example.com ",
      treasurer: { ok: false, reason: "none" },
    });
    expect(r.recipients).toEqual(["Treasurer@Example.com", "submitter@example.com"]);
  });

  it("collapses duplicates", () => {
    const r = pickReimbursementNotifyRecipients({
      ...base,
      recordHolderEmails: ["a@example.com", "A@example.com", " a@example.com"],
      treasurer: { ok: false, reason: "none" },
    });
    expect(r.recipients).toEqual(["a@example.com"]);
  });

  it("returns an empty list with a reason when there are no holders (no throw)", () => {
    const r = pickReimbursementNotifyRecipients({
      ...base,
      recordHolderEmails: [],
      treasurer: treasurerOk,
    });
    expect(r.recipients).toEqual([]);
    expect(r.reason).toBe("fallback_treasurer_lacks_record");
  });
});

describe("reimbursementTransactionStamp", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("stamps the acting user and now for a submitted row, with a null board minute", () => {
    const s = reimbursementTransactionStamp(
      { status: "submitted", reviewedByUserId: null, reviewedAt: null, boardMinute: null },
      "u-pay",
      now,
    );
    expect(s).toEqual({ approvedByUserId: "u-pay", approvedAt: now, boardMinute: null });
  });

  it("ignores any stray boardMinute on a submitted row", () => {
    const s = reimbursementTransactionStamp(
      { status: "submitted", reviewedByUserId: null, reviewedAt: null, boardMinute: "stray" },
      "u-pay",
      now,
    );
    expect(s.boardMinute).toBeNull();
  });

  it("copies reviewer, time and minute from a legacy approved row", () => {
    const reviewedAt = new Date("2026-08-01T00:00:00Z");
    const s = reimbursementTransactionStamp(
      { status: "approved", reviewedByUserId: "u-board", reviewedAt, boardMinute: "Minute 4" },
      "u-pay",
      now,
    );
    expect(s).toEqual({ approvedByUserId: "u-board", approvedAt: reviewedAt, boardMinute: "Minute 4" });
  });

  it("never yields a null approvedAt for a malformed legacy row", () => {
    const s = reimbursementTransactionStamp(
      { status: "approved", reviewedByUserId: null, reviewedAt: null, boardMinute: null },
      "u-pay",
      now,
    );
    expect(s.approvedAt).toBe(now);
    expect(s.approvedByUserId).toBe("u-pay");
  });
});
