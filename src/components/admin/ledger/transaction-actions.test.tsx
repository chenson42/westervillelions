/**
 * T34: TransactionActions lock labels and Move gating (Phase 3 design,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md). Node env, no jsdom:
 * renderToStaticMarkup plus the pure eligibility helper it is built on.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import TransactionActions from "./transaction-actions";
import ReconcileToggle from "./reconcile-toggle";
import { moveButtonState } from "./transaction-move-eligibility";
import { CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE, MANAGE_REQUIRED_MESSAGE } from "@/lib/ledger-correction";
import { LOCK_COPY } from "@/lib/ledger-transaction-lock";
import type { LedgerFund, LedgerTransaction } from "@/lib/db/schema";

const CLUB = "00000000-0000-4000-8000-0000000000c1";
const FOUNDATION = "00000000-0000-4000-8000-0000000000f1";
const NOW = "2026-10-01T12:00:00.000Z";

function fund(id: string, entityId: string, kind: string): LedgerFund {
  return { id, entityId, kind, slug: kind, name: `${kind} fund`, openingBalanceCents: 0, isActive: true } as LedgerFund;
}
const adminFund = fund("a0000000-0000-4000-8000-000000000001", CLUB, "administrative");
const activityFund = fund("a0000000-0000-4000-8000-000000000002", CLUB, "activity");
const charitableFund = fund("a0000000-0000-4000-8000-000000000003", FOUNDATION, "charitable");
const clubFunds = [adminFund, activityFund];
const allFunds = [adminFund, activityFund, charitableFund];

function txn(over: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    entityId: CLUB,
    fundId: adminFund.id,
    flow: "income",
    status: "posted",
    amountCents: 5000,
    txnDate: "2026-09-12",
    party: "Test Donor",
    memo: null,
    approvedAt: null,
    duesPaymentId: null,
    transferGroupId: null,
    reconciled: false,
    reconciledSessionId: null,
    bankAccountId: null,
    categoryId: null,
    ...over,
  } as unknown as LedgerTransaction;
}

function render(
  transaction: LedgerTransaction,
  opts: {
    funds?: LedgerFund[];
    moveFunds?: LedgerFund[];
    banks?: string[];
    canManage?: boolean;
    ackStatus?: "pending" | "sent" | null;
    foundationPointer?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <TransactionActions
      transaction={transaction}
      entityId={transaction.entityId}
      funds={opts.funds ?? clubFunds}
      moveFunds={opts.moveFunds ?? allFunds}
      entityIdsWithActiveBank={opts.banks ?? [CLUB, FOUNDATION]}
      foundationPointer={opts.foundationPointer ?? false}
      categories={[]}
      bankAccounts={[]}
      budgetLines={[]}
      canManage={opts.canManage ?? true}
      ackStatus={opts.ackStatus ?? null}
      nowIso={NOW}
      entitySlug="club"
    />,
  );
}

/** The boolean disabled attribute (class names also contain "disabled:"). */
const DISABLED = /\sdisabled=""/;

/** The opening tag (attributes) of the button whose text is exactly `label`. */
function buttonTag(html: string, label: string): string | null {
  const re = new RegExp(`<button([^>]*)>${label}</button>`);
  const m = re.exec(html);
  return m ? m[1] : null;
}

describe("TransactionActions: lock labels", () => {
  it("renders an unlocked row exactly as before: enabled Edit and Delete, no label", () => {
    const html = render(txn({ fundId: activityFund.id }));
    expect(buttonTag(html, "Edit")).not.toBeNull();
    expect(buttonTag(html, "Edit")).not.toMatch(DISABLED);
    expect(buttonTag(html, "Delete")).not.toMatch(DISABLED);
    expect(html).not.toContain("Approved.");
    expect(html).not.toContain("Reconciled.");
  });

  it("approved row: Edit and Delete disabled with the reason, label shown", () => {
    const html = render(txn({ approvedAt: new Date("2026-09-20") }));
    expect(buttonTag(html, "Edit")).toMatch(DISABLED);
    expect(buttonTag(html, "Delete")).toMatch(DISABLED);
    expect(html).toContain(LOCK_COPY.approved.nextStep);
    expect(html).toContain("Approved.");
    expect(html).not.toContain(">Move<");
  });

  it("rejected row: Edit and Delete disabled with the rejected reason", () => {
    const html = render(txn({ status: "rejected" }));
    expect(buttonTag(html, "Edit")).toMatch(DISABLED);
    expect(buttonTag(html, "Delete")).toMatch(DISABLED);
    expect(html).toContain("Rejected.");
  });

  it("closed-session reconciled row: Edit and Delete disabled, label says Reconciled", () => {
    const html = render(txn({ reconciled: true, reconciledSessionId: "c0000000-0000-4000-8000-000000000001" }));
    expect(buttonTag(html, "Edit")).toMatch(DISABLED);
    expect(buttonTag(html, "Delete")).toMatch(DISABLED);
    expect(html).toContain(LOCK_COPY.reconciled_session.nextStep);
  });

  it("legacy-reconciled row (no session) is NOT edit-locked", () => {
    const html = render(txn({ reconciled: true, fundId: activityFund.id }));
    expect(buttonTag(html, "Edit")).not.toMatch(DISABLED);
    expect(buttonTag(html, "Delete")).not.toMatch(DISABLED);
  });

  it("transfer leg: edit stays available, a 'Part of a transfer' label is shown", () => {
    const html = render(txn({ transferGroupId: "d0000000-0000-4000-8000-000000000001" }));
    expect(html).toContain("Edit transfer");
    expect(html).toContain("Part of a transfer.");
    expect(html).not.toContain(">Move<");
  });
});

describe("TransactionActions: Move button gating (D1)", () => {
  it("is present and enabled on an unreconciled Administrative income row", () => {
    const html = render(txn());
    const tag = buttonTag(html, "Move");
    expect(tag).not.toBeNull();
    expect(tag).not.toMatch(DISABLED);
  });

  it("is absent on an expense row", () => {
    expect(render(txn({ flow: "expense" }))).not.toContain(">Move<");
  });

  it("is absent on a transfer leg", () => {
    expect(render(txn({ transferGroupId: "d0000000-0000-4000-8000-000000000001" }))).not.toContain(">Move<");
  });

  it("is present on a Foundation income row (the cross-entity cell)", () => {
    const html = render(txn({ entityId: FOUNDATION, fundId: charitableFund.id }), { funds: [charitableFund] });
    expect(buttonTag(html, "Move")).not.toBeNull();
    expect(buttonTag(html, "Move")).not.toMatch(DISABLED);
  });

  it("is absent on an Activity row (no legal destination)", () => {
    expect(render(txn({ fundId: activityFund.id }))).not.toContain(">Move<");
  });

  it("is absent on pending and dues-synced rows", () => {
    expect(render(txn({ status: "pending" }))).not.toContain(">Move<");
    expect(render(txn({ duesPaymentId: "e0000000-0000-4000-8000-000000000001" }))).not.toContain(">Move<");
  });

  it("is present but disabled with the permission message when the row needs manage and the caller lacks it", () => {
    const html = render(txn({ reconciled: true }), { canManage: false });
    const tag = buttonTag(html, "Move");
    expect(tag).toMatch(DISABLED);
    expect(tag).toContain(MANAGE_REQUIRED_MESSAGE);
    expect(html).toContain(MANAGE_REQUIRED_MESSAGE);
  });

  it("is enabled for a reconciled row when the caller can manage", () => {
    const html = render(txn({ reconciled: true }), { canManage: true });
    expect(buttonTag(html, "Move")).not.toMatch(DISABLED);
  });

  it("prior-fiscal-year row needs manage (2026-06-30 is FY ended before 2026-10-01)", () => {
    expect(render(txn({ txnDate: "2026-06-30" }), { canManage: false })).toContain(MANAGE_REQUIRED_MESSAGE);
    expect(buttonTag(render(txn({ txnDate: "2026-07-01" }), { canManage: false }), "Move")).not.toMatch(
      DISABLED,
    );
  });
});

describe("moveButtonState", () => {
  const base = {
    funds: clubFunds,
    entityIdsWithActiveBank: [CLUB, FOUNDATION],
    canManage: true,
    now: new Date(NOW),
  };
  it("omits when the row's fund is not in the supplied list", () => {
    expect(moveButtonState({ ...base, funds: [], transaction: txn() })).toEqual({ kind: "omit" });
  });
  it("enabled for the same-entity cell, with no cross-entity hint", () => {
    expect(moveButtonState({ ...base, transaction: txn() })).toEqual({ kind: "enabled" });
  });
});

/** C37: the Foundation row's Move button (cross-entity cell) */
describe("moveButtonState: Foundation to Club (C37)", () => {
  const base = {
    funds: allFunds,
    entityIdsWithActiveBank: [CLUB, FOUNDATION],
    canManage: true,
    now: new Date(NOW),
  };
  const foundationRow = (over: Partial<LedgerTransaction> = {}) =>
    txn({ entityId: FOUNDATION, fundId: charitableFund.id, ...over });

  it("is enabled for a manage caller and flagged cross-entity-only", () => {
    expect(moveButtonState({ ...base, transaction: foundationRow() })).toEqual({
      kind: "enabled",
      crossEntityOnly: true,
    });
  });

  it("is disabled with the cross-entity permission message for a record-only caller", () => {
    expect(moveButtonState({ ...base, canManage: false, transaction: foundationRow() })).toEqual({
      kind: "disabled",
      reason: CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE,
      crossEntityOnly: true,
    });
  });

  it("is omitted when the Club has no active bank account", () => {
    expect(
      moveButtonState({ ...base, entityIdsWithActiveBank: [FOUNDATION], transaction: foundationRow() }),
    ).toEqual({ kind: "omit" });
  });

  it("is omitted for an expense row and for a prior-fiscal-year Foundation row (X10)", () => {
    expect(moveButtonState({ ...base, transaction: foundationRow({ flow: "expense" }) })).toEqual({
      kind: "omit",
    });
    expect(moveButtonState({ ...base, transaction: foundationRow({ txnDate: "2026-06-30" }) })).toEqual({
      kind: "omit",
    });
  });

  it("stays enabled for a closed-session Foundation row (the dialog shows the checklist)", () => {
    expect(
      moveButtonState({
        ...base,
        transaction: foundationRow({ reconciled: true, reconciledSessionId: "c0000000-0000-4000-8000-000000000001" }),
      }),
    ).toEqual({ kind: "enabled", crossEntityOnly: true });
  });

  it("Club Administrative income is unchanged (same-entity only) and Club Activity income is omitted", () => {
    expect(moveButtonState({ ...base, transaction: txn() })).toEqual({ kind: "enabled" });
    expect(moveButtonState({ ...base, transaction: txn({ fundId: activityFund.id }) })).toEqual({
      kind: "omit",
    });
  });

  it("a closed-session Foundation row shows the 'see Move to the Club' sentence beside the lock label", () => {
    const html = render(
      txn({
        entityId: FOUNDATION,
        fundId: charitableFund.id,
        reconciled: true,
        reconciledSessionId: "c0000000-0000-4000-8000-000000000001",
      }),
    );
    expect(html).toContain("see Move to the Club");
    expect(render(txn())).not.toContain("see Move to the Club");
  });
});

describe("ReconcileToggle locked state", () => {
  it("is disabled with the closed-session explanation when locked", () => {
    const html = renderToStaticMarkup(<ReconcileToggle transactionId="x" reconciled locked />);
    expect(html).toMatch(DISABLED);
    expect(html).toContain("Reopen the session to change this");
  });
  it("stays enabled when not locked (legacy mark only)", () => {
    const html = renderToStaticMarkup(<ReconcileToggle transactionId="x" reconciled />);
    expect(html).not.toMatch(DISABLED);
  });
});

describe("no native dialogs", () => {
  it("TransactionActions and the correction dialogs never call confirm/alert/prompt", () => {
    for (const file of [
      "transaction-actions.tsx",
      "move-transaction-dialog.tsx",
      "delete-transaction-dialog.tsx",
      "sweep-prefill-launcher.tsx",
    ]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/);
    }
  });
});
