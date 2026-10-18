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
            rejectedByUserId: null,
            rejectedAt: null,
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
          entityDonationsDeductible: true,
        },
      ],
    });

    const html = renderToStaticMarkup(
      <DonorDetailClient donor={donor} canRecord={true} canManage={false} />,
    );

    expect(html).toContain(">Acknowledge<");
  });
});

describe("DonorDetailClient — total counts Foundation gifts only (B-172)", () => {
  function giftRow(id: string, amountCents: number, deductible: boolean, fundName: string) {
    return {
      txn: {
        id,
        entityId: deductible ? "entity-foundation" : "entity-club",
        fundId: "fund-x",
        bankAccountId: null,
        txnDate: "2026-09-01",
        flow: "income" as const,
        categoryId: null,
        amountCents,
        party: "Example Donor",
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
        rejectedByUserId: null,
        rejectedAt: null,
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
        fundName,
        entityName: deductible ? "Foundation" : "Club",
      },
      ackStatus: null,
      ackId: null,
      entityDonationsDeductible: deductible,
    };
  }

  it("sums only the deductible-entity rows, labels the Public Funds row, and offers no Acknowledge on it", () => {
    const donor = baseDonor({
      givingHistory: [
        giftRow("t-found", 10000, true, "Charitable Fund"),
        giftRow("t-public", 50000, false, "Community Money"),
      ] as DonorWithGivingHistory["givingHistory"],
    });
    const html = renderToStaticMarkup(<DonorDetailClient donor={donor} canRecord={true} canManage={false} />);
    expect(html).toContain("$100.00");
    expect(html).not.toContain("$600.00");
    expect(html).toContain("Foundation gifts only");
    expect(html).toContain("Community Money, not yet a Foundation gift");
    // One Acknowledge button: the Foundation row's, not the Public Funds row's.
    expect((html.match(/>Acknowledge</g) ?? []).length).toBe(1);
  });

  it("a donor with only Public Funds gifts shows a $0.00 total", () => {
    const donor = baseDonor({
      givingHistory: [giftRow("t-public", 50000, false, "Public Funds")] as DonorWithGivingHistory["givingHistory"],
    });
    const html = renderToStaticMarkup(<DonorDetailClient donor={donor} canRecord={true} canManage={false} />);
    expect(html).toContain("$0.00");
    expect(html).not.toContain(">Acknowledge<");
  });
});
