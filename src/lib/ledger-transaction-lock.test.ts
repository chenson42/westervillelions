/** T4-T7: the pure lock classifier and the move tier (DECISION-109). */
import { describe, it, expect } from "vitest";
import {
  CLOSED_SESSION_LOCK_MESSAGE,
  LOCK_COPY,
  classifyTransactionLock,
  editLockKind,
  isTransactionReconciled,
  moveBlockKind,
  requiredMoveTier,
  transactionLockKinds,
  type LockableRow,
  type TransactionLockKind,
} from "./ledger-transaction-lock";

function row(over: Partial<LockableRow> = {}): LockableRow {
  return {
    approvedAt: null,
    status: "posted",
    duesPaymentId: null,
    transferGroupId: null,
    reconciled: false,
    reconciledSessionId: null,
    txnDate: "2026-09-15",
    ...over,
  };
}

const APPROVED = { approvedAt: new Date("2026-09-01") };
const REJECTED = { status: "rejected" };
const PENDING = { status: "pending" };
const DUES = { duesPaymentId: "dues-1" };
const LEG = { transferGroupId: "group-1" };
const SESSION = { reconciled: true, reconciledSessionId: "session-1" };
const LEGACY = { reconciled: true, reconciledSessionId: null };

describe("classifyTransactionLock (T4)", () => {
  it("an unlocked row has no kind", () => {
    expect(classifyTransactionLock(row())).toBeNull();
    expect(transactionLockKinds(row())).toEqual([]);
  });

  it.each<[string, Partial<LockableRow>, TransactionLockKind]>([
    ["approved", APPROVED, "approved"],
    ["rejected", REJECTED, "rejected"],
    ["pending", PENDING, "pending"],
    ["dues_synced", DUES, "dues_synced"],
    ["transfer_leg", LEG, "transfer_leg"],
    ["reconciled_session", SESSION, "reconciled_session"],
    ["reconciled_legacy", LEGACY, "reconciled_legacy"],
  ])("%s alone", (_name, over, kind) => {
    expect(classifyTransactionLock(row(over))).toBe(kind);
    expect(transactionLockKinds(row(over))).toEqual([kind]);
  });

  it("approved + reconciled returns approved first, with both listed in precedence order", () => {
    const r = row({ ...APPROVED, ...SESSION });
    expect(classifyTransactionLock(r)).toBe("approved");
    expect(transactionLockKinds(r)).toEqual(["approved", "reconciled_session"]);
  });

  it("a session pointer is reconciled_session, never also legacy", () => {
    expect(transactionLockKinds(row(SESSION))).toEqual(["reconciled_session"]);
  });

  it("isTransactionReconciled is true for either mark and false for neither", () => {
    expect(isTransactionReconciled(row(SESSION))).toBe(true);
    expect(isTransactionReconciled(row(LEGACY))).toBe(true);
    expect(isTransactionReconciled(row({ reconciledSessionId: "s", reconciled: false }))).toBe(true);
    expect(isTransactionReconciled(row())).toBe(false);
  });
});

describe("editLockKind / moveBlockKind (T5)", () => {
  it("editLockKind mirrors the PATCH/DELETE guards: approved, rejected, session only", () => {
    expect(editLockKind(row(APPROVED))).toBe("approved");
    expect(editLockKind(row(REJECTED))).toBe("rejected");
    expect(editLockKind(row(SESSION))).toBe("reconciled_session");
    expect(editLockKind(row({ ...APPROVED, ...SESSION }))).toBe("approved");
    // NOT edit-locked today:
    expect(editLockKind(row(PENDING))).toBeNull();
    expect(editLockKind(row(LEG))).toBeNull();
    expect(editLockKind(row(DUES))).toBeNull();
    expect(editLockKind(row(LEGACY))).toBeNull();
    expect(editLockKind(row())).toBeNull();
  });

  it("moveBlockKind mirrors the move table; reconciliation is a tier, not a block", () => {
    expect(moveBlockKind(row(APPROVED))).toBe("approved");
    expect(moveBlockKind(row(REJECTED))).toBe("rejected");
    expect(moveBlockKind(row(PENDING))).toBe("pending");
    expect(moveBlockKind(row(DUES))).toBe("dues_synced");
    expect(moveBlockKind(row(LEG))).toBe("transfer_leg");
    expect(moveBlockKind(row(SESSION))).toBeNull();
    expect(moveBlockKind(row(LEGACY))).toBeNull();
    expect(moveBlockKind(row())).toBeNull();
  });
});

describe("requiredMoveTier (T6)", () => {
  const NOW = new Date(2026, 9, 1); // 2026-10-01, FY2026

  it("an unreconciled current-FY row is record", () => {
    expect(requiredMoveTier(row({ txnDate: "2026-09-15" }), NOW)).toEqual({ tier: "record", reasons: [] });
  });

  it("session-reconciled and legacy-reconciled are manage", () => {
    expect(requiredMoveTier(row(SESSION), NOW)).toEqual({ tier: "manage", reasons: ["reconciled"] });
    expect(requiredMoveTier(row(LEGACY), NOW)).toEqual({ tier: "manage", reasons: ["reconciled"] });
  });

  it("a prior-FY row is manage; both reasons are listed when both apply", () => {
    expect(requiredMoveTier(row({ txnDate: "2025-12-01" }), NOW)).toEqual({
      tier: "manage",
      reasons: ["prior_fiscal_year"],
    });
    expect(requiredMoveTier(row({ ...SESSION, txnDate: "2025-12-01" }), NOW)).toEqual({
      tier: "manage",
      reasons: ["reconciled", "prior_fiscal_year"],
    });
  });

  it("fiscal-year edge with now = 2026-10-01: 2026-06-30 is prior, 2026-07-01 is current", () => {
    expect(requiredMoveTier(row({ txnDate: "2026-06-30" }), NOW).tier).toBe("manage");
    expect(requiredMoveTier(row({ txnDate: "2026-07-01" }), NOW).tier).toBe("record");
  });

  it("a row dated in the next fiscal year is record", () => {
    expect(requiredMoveTier(row({ txnDate: "2027-08-01" }), NOW).tier).toBe("record");
  });

  it("now = 2026-06-30 makes 2026-06-30 current", () => {
    expect(requiredMoveTier(row({ txnDate: "2026-06-30" }), new Date(2026, 5, 30)).tier).toBe("record");
  });
});

describe("LOCK_COPY (T7)", () => {
  const KINDS: TransactionLockKind[] = [
    "approved",
    "rejected",
    "pending",
    "dues_synced",
    "transfer_leg",
    "reconciled_session",
    "reconciled_legacy",
  ];
  it("has a label and a next step for every kind", () => {
    for (const k of KINDS) {
      expect(LOCK_COPY[k].label.length).toBeGreaterThan(0);
      expect(LOCK_COPY[k].nextStep.length).toBeGreaterThan(0);
    }
    expect(Object.keys(LOCK_COPY).sort()).toEqual([...KINDS].sort());
  });

  it("CLOSED_SESSION_LOCK_MESSAGE names the next step", () => {
    expect(CLOSED_SESSION_LOCK_MESSAGE).toMatch(/Reopen the session/);
  });
});
