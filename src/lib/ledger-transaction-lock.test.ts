/** T4-T7 and C7-C8: the pure lock classifier and the move tier (DECISION-109/112). */
import { describe, it, expect } from "vitest";
import {
  CLOSED_SESSION_LOCK_MESSAGE,
  LOCK_COPY,
  classifyTransactionLock,
  editLockKind,
  isTransactionReconciled,
  moveBlockKind,
  requiredMoveTier,
  crossEntityBlockKind,
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

describe("requiredMoveTier with a cross-entity destination (C7)", () => {
  const NOW = new Date(2026, 9, 1); // 2026-10-01, FY2026
  const CROSS = { crossEntity: true };

  it("a clean current-year row is manage with exactly cross_entity", () => {
    expect(requiredMoveTier(row(), NOW, CROSS)).toEqual({ tier: "manage", reasons: ["cross_entity"] });
  });

  it("cross_entity is listed first and accumulates reconciled and prior_fiscal_year", () => {
    expect(requiredMoveTier(row({ ...SESSION, txnDate: "2025-12-01" }), NOW, CROSS)).toEqual({
      tier: "manage",
      reasons: ["cross_entity", "reconciled", "prior_fiscal_year"],
    });
    expect(requiredMoveTier(row(LEGACY), NOW, CROSS).reasons).toEqual(["cross_entity", "reconciled"]);
  });

  it("same-entity tiering is unchanged (absent, undefined and false all behave the same)", () => {
    for (const opts of [undefined, {}, { crossEntity: false }]) {
      expect(requiredMoveTier(row(), NOW, opts)).toEqual({ tier: "record", reasons: [] });
      expect(requiredMoveTier(row(SESSION), NOW, opts)).toEqual({ tier: "manage", reasons: ["reconciled"] });
    }
  });

  it("fiscal-year edges behave as for the same-entity tier", () => {
    expect(requiredMoveTier(row({ txnDate: "2026-06-30" }), NOW, CROSS).reasons).toEqual([
      "cross_entity",
      "prior_fiscal_year",
    ]);
    expect(requiredMoveTier(row({ txnDate: "2026-07-01" }), NOW, CROSS).reasons).toEqual(["cross_entity"]);
    expect(
      requiredMoveTier(row({ txnDate: "2026-06-30" }), new Date(2026, 5, 30), CROSS).reasons,
    ).toEqual(["cross_entity"]);
  });
});

describe("crossEntityBlockKind (C8)", () => {
  const NOW = new Date(2026, 9, 1);

  it("a clean current-year row has no pure block", () => {
    expect(crossEntityBlockKind(row(), NOW)).toBeNull();
  });

  it("a prior-year row is refused before reconciliation is considered (X2)", () => {
    expect(crossEntityBlockKind(row({ txnDate: "2025-12-01" }), NOW)).toBe("prior_fiscal_year_cross_entity");
    expect(crossEntityBlockKind(row({ ...SESSION, txnDate: "2025-12-01" }), NOW)).toBe(
      "prior_fiscal_year_cross_entity",
    );
  });

  it("a closed session beats the legacy mark; the legacy mark alone is reconciled_legacy", () => {
    expect(crossEntityBlockKind(row(SESSION), NOW)).toBe("reconciled_session");
    expect(crossEntityBlockKind(row(LEGACY), NOW)).toBe("reconciled_legacy");
    // reconciled = false but a session pointer present still counts as a session.
    expect(crossEntityBlockKind(row({ reconciledSessionId: "s1" }), NOW)).toBe("reconciled_session");
  });

  it("edge dates for now = 2026-10-01 and 2026-06-30", () => {
    expect(crossEntityBlockKind(row({ txnDate: "2026-06-30" }), NOW)).toBe("prior_fiscal_year_cross_entity");
    expect(crossEntityBlockKind(row({ txnDate: "2026-07-01" }), NOW)).toBeNull();
    expect(crossEntityBlockKind(row({ txnDate: "2026-06-30" }), new Date(2026, 5, 30))).toBeNull();
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
