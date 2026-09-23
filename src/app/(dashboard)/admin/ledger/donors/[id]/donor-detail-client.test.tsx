/**
 * Regression test for the donor-detail page's Acknowledge button gate
 * (docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md, Part 2
 * follow-up: the coordinator caught that this page's own
 * `amountCents >= 25000` copy was left behind when the register and the
 * Unlinked Gifts worklist both stopped gating on amount, leaving the same
 * transaction acknowledgeable from two entry points but silently not a
 * third). Proves the fix directly at the component-render level, alongside
 * the static-source guard in acknowledge-threshold-consolidation.test.ts.
 *
 * Rendered via react-dom/server's renderToStaticMarkup — DonorDetailClient's
 * only Radix Dialog.Root instances (Edit donor) render with `open={false}`
 * on initial mount, so their Dialog.Portal contributes nothing to the
 * static markup and this component is fully inspectable without a DOM,
 * same technique as txn-donor-actions.test.tsx.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DonorWithGivingHistory } from "@/lib/ledger-queries";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DonorDetailClient from "./donor-detail-client";

function baseDonor(
  overrides: Partial<DonorWithGivingHistory> = {},
): DonorWithGivingHistory {
  return {
    id: "donor-1",
    name: "Trucco Construction Co",
    emails: [],
    address: null,
    memberId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    givingHistory: [],
    ...overrides,
  };
}

describe("DonorDetailClient — Acknowledge button gate (any amount)", () => {
  it("renders the Acknowledge button for a sub-$250 gift with no acknowledgment yet", () => {
    const donor = baseDonor({
      givingHistory: [
        {
          txn: {
            id: "txn-small",
            entityId: "entity-foundation",
            fundId: "fund-charitable",
            bankAccountId: null,
            txnDate: "2026-09-01",
            flow: "income",
            categoryId: null,
            amountCents: 2000, // $20
            party: "Jane Donor",
            memo: null,
            beneficiaryCause: null,
            publicNote: null,
            paymentMethod: "check",
            checkNumber: null,
            receiptStorageKey: null,
            receiptWaivedAt: null,
            receiptWaivedByUserId: null,
            receiptWaiverReason: null,
            transferGroupId: null,
            status: "posted",
            approvedByUserId: null,
            approvedAt: null,
            boardMinute: null,
            rejectionReason: null,
            reconciled: false,
            reconciledAt: null,
            recordedByUserId: "user-1",
            duesPaymentId: null,
            syncStale: false,
            donorId: "donor-1",
            reconciledSessionId: null,
            budgetLineId: null,
            createdAt: new Date("2026-09-01"),
            updatedAt: new Date("2026-09-01"),
            fundName: "Charitable Fund",
            entityName: "Foundation",
          },
          ackStatus: null,
          ackId: null,
        },
      ],
    });

    const html = renderToStaticMarkup(
      <DonorDetailClient donor={donor} canRecord={true} canManage={false} />,
    );

    expect(html).toContain(">Acknowledge<");
  });
});
