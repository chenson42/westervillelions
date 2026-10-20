/** T4-T7 and C7-C8: the pure lock classifier and the move tier (DECISION-109/112). */
import { describe, it, expect } from "vitest";
import {
  CLOSED_SESSION_LOCK_MESSAGE,
  LOCK_COPY,
  classifyTransactionLock,
  editLockKind,
  editLockDisplayKind,
  isTransactionReconciled,
  moveBlockKind,
  sweepEditAllowance,
  sweepLockKind,
  sweepRefusal,
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
    "paid_reimbursement",
    "approved",
    "rejected",
    "pending",
    "dues_synced",
    "sweep_batch",
    "swept_copy",
    "swept_source",
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

describe("paid_reimbursement lock kind (T26, B-108 / DECISION-114)", () => {
  const PAID = { ...APPROVED, paidReimbursement: true };

  it("is first in precedence and implies approved", () => {
    expect(transactionLockKinds(row(PAID))).toEqual(["paid_reimbursement", "approved"]);
    expect(classifyTransactionLock(row(PAID))).toBe("paid_reimbursement");
    expect(transactionLockKinds(row({ ...PAID, ...SESSION }))).toEqual([
      "paid_reimbursement",
      "approved",
      "reconciled_session",
    ]);
  });

  it("without the flag the classification is approved", () => {
    expect(classifyTransactionLock(row(APPROVED))).toBe("approved");
    expect(classifyTransactionLock(row({ ...APPROVED, paidReimbursement: false }))).toBe("approved");
  });

  it("the flag alone, on an unapproved row, adds no lock kind", () => {
    expect(transactionLockKinds(row({ paidReimbursement: true }))).toEqual([]);
  });

  it("editLockKind is unchanged: it still reports approved", () => {
    expect(editLockKind(row(PAID))).toBe("approved");
  });

  it("editLockDisplayKind shows paid_reimbursement only for an approved row with the flag", () => {
    expect(editLockDisplayKind(row(PAID))).toBe("paid_reimbursement");
    expect(editLockDisplayKind(row(APPROVED))).toBe("approved");
    expect(editLockDisplayKind(row(REJECTED))).toBe("rejected");
    expect(editLockDisplayKind(row(SESSION))).toBe("reconciled_session");
    expect(editLockDisplayKind(row())).toBeNull();
  });

  it("the copy is the reimbursement copy and no longer advises a refund entry", () => {
    expect(LOCK_COPY.paid_reimbursement.label).toBe("Paid reimbursement");
    expect(LOCK_COPY.paid_reimbursement.nextStep).toMatch(/Use Correct/);
    expect(LOCK_COPY.paid_reimbursement.nextStep).not.toMatch(/refund entry/);
    // the approved copy for a non-reimbursement approved row is untouched
    expect(LOCK_COPY.approved.nextStep).toMatch(/refund entry/);
  });
});

describe("sweep lock kinds (B-172 Inc 2a, ruling A6)", () => {
  const NONE = { isLeg: false, hasLiveCopy: false, hasAnyCopy: false };
  const LEG_ROLE = { ...NONE, isLeg: true };
  const SOURCE_ROLE = { ...NONE, hasLiveCopy: true, hasAnyCopy: true };
  const COPY = { sweepLegTxnId: "leg-1" };

  it("sweepLockKind: copy by its column, leg and source by the loaded role", () => {
    expect(sweepLockKind({})).toBeNull();
    expect(sweepLockKind({ sweepRole: NONE })).toBeNull();
    expect(sweepLockKind(COPY)).toBe("swept_copy");
    expect(sweepLockKind({ sweepRole: LEG_ROLE })).toBe("sweep_batch");
    expect(sweepLockKind({ sweepRole: SOURCE_ROLE })).toBe("swept_source");
    // a source whose only copies were rejected is not locked
    expect(sweepLockKind({ sweepRole: { ...NONE, hasAnyCopy: true } })).toBeNull();
  });

  it("the three kinds come after the status kinds and dues_synced, before transfer_leg", () => {
    const leg = row({ ...LEG, ...PENDING, ...DUES, sweepRole: LEG_ROLE });
    expect(transactionLockKinds(leg)).toEqual([
      "pending",
      "dues_synced",
      "sweep_batch",
      "transfer_leg",
    ]);
    expect(transactionLockKinds(row({ ...APPROVED, ...COPY, ...SESSION }))).toEqual([
      "approved",
      "swept_copy",
      "reconciled_session",
    ]);
    expect(classifyTransactionLock(row({ sweepRole: SOURCE_ROLE }))).toBe("swept_source");
  });

  it("editLockKind is unchanged: a copy, leg and source stay editable as far as it is concerned", () => {
    expect(editLockKind(row({ ...COPY }))).toBeNull();
    expect(editLockKind(row({ sweepRole: LEG_ROLE }))).toBeNull();
    expect(editLockKind(row({ ...APPROVED }))).toBe("approved");
    expect(editLockKind(row({ ...REJECTED }))).toBe("rejected");
    expect(editLockKind(row({ ...SESSION }))).toBe("reconciled_session");
  });

  it("sweepEditAllowance: a copy takes donorId and memo only; leg and source take nothing", () => {
    expect(sweepEditAllowance("swept_copy", ["donorId"])).toBe(true);
    expect(sweepEditAllowance("swept_copy", ["memo"])).toBe(true);
    expect(sweepEditAllowance("swept_copy", ["donorId", "memo"])).toBe(true);
    for (const key of [
      "amountCents",
      "txnDate",
      "categoryId",
      "party",
      "flow",
      "bankAccountId",
    ]) {
      expect(sweepEditAllowance("swept_copy", [key]), key).toBe(false);
      expect(sweepEditAllowance("swept_copy", ["donorId", key]), key).toBe(false);
    }
    expect(sweepEditAllowance("swept_copy", ["", "unknownKey"])).toBe(false);
    for (const kind of ["sweep_batch", "swept_source"] as const) {
      expect(sweepEditAllowance(kind, ["donorId"])).toBe(false);
      expect(sweepEditAllowance(kind, ["memo"])).toBe(false);
      expect(sweepEditAllowance(kind, ["amountCents"])).toBe(false);
      expect(sweepEditAllowance(kind, [])).toBe(false);
    }
    expect(sweepEditAllowance(null, ["amountCents"])).toBe(true);
  });

  it("moveBlockKind: a copy is swept_copy; the leg keeps transfer_leg; no swept_source branch", () => {
    expect(moveBlockKind({ ...row(), sweepLegTxnId: "leg-1" })).toBe("swept_copy");
    expect(moveBlockKind({ ...row(LEG), sweepLegTxnId: null })).toBe("transfer_leg");
    // status kinds still win
    expect(moveBlockKind({ ...row(APPROVED), sweepLegTxnId: "leg-1" })).toBe("approved");
    expect(moveBlockKind({ ...row(), sweepLegTxnId: null })).toBeNull();
  });

  it("sweepRefusal: a distinct, fund-name-free message per kind and action; code is the kind", () => {
    const seen = new Set<string>();
    for (const kind of ["sweep_batch", "swept_copy", "swept_source"] as const) {
      for (const action of ["edit", "delete", "split"] as const) {
        const r = sweepRefusal(kind, action);
        expect(r.code).toBe(kind);
        expect(r.error).not.toMatch(/Activity|Public Funds/);
        seen.add(r.error);
      }
    }
    expect(seen.size).toBe(9);
  });

  it("sweepRefusal('sweep_batch', action, batch): the message follows the batch's state; the other kinds ignore the batch", () => {
    const at = new Date("2026-10-20T00:00:00Z");
    const posted = sweepRefusal("sweep_batch", "delete", { status: "posted", approvedAt: null }).error;
    const pending = sweepRefusal("sweep_batch", "edit", { status: "pending", approvedAt: null }).error;
    const approved = sweepRefusal("sweep_batch", "split", { status: "posted", approvedAt: at }).error;
    const rejected = sweepRefusal("sweep_batch", "edit", { status: "rejected", approvedAt: null }).error;
    expect(posted).toMatch(/Void it/);
    expect(pending).toMatch(/Reject it from Approvals/);
    expect(approved).toMatch(/correcting entry/);
    expect(approved).not.toMatch(/void/i);
    expect(rejected).toMatch(/kept as a record/);
    expect(new Set([posted, pending, approved, rejected]).size).toBe(4);
    // the verb still follows the action
    expect(approved).toMatch(/cannot be split/);
    // no third argument keeps the generic sentence
    expect(sweepRefusal("sweep_batch", "edit").error).toMatch(/before it is approved/);
    // copy and source are unchanged by a batch argument
    const batch = { status: "posted", approvedAt: at };
    expect(sweepRefusal("swept_copy", "edit", batch)).toEqual(sweepRefusal("swept_copy", "edit"));
    expect(sweepRefusal("swept_source", "delete", batch)).toEqual(sweepRefusal("swept_source", "delete"));
  });

  it("LOCK_COPY for the sweep kinds is free of any fund name", () => {
    for (const k of ["sweep_batch", "swept_copy", "swept_source"] as const) {
      expect(`${LOCK_COPY[k].label} ${LOCK_COPY[k].nextStep}`).not.toMatch(/Activity|Public Funds/);
    }
  });
});
