/**
 * Unit test for TxnDonorActions' Acknowledge button gate (Phase 3 design's
 * named unit test #11, docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md,
 * Part 2: "Acknowledge at any amount"). Before this ticket the button only
 * rendered at amountCents >= 25000 — this proves the gate is actually gone,
 * not just relabeled.
 *
 * Rendered via react-dom/server's renderToStaticMarkup, same technique as
 * member-directory.test.tsx — TxnDonorActions has no Radix Dialog.Portal in
 * its own render tree (the dialogs it opens are conditionally mounted only
 * once a button is clicked, which this static render never does), so it
 * renders fully under this project's DOM-less Vitest config. next/navigation
 * is mocked because AcknowledgeDialog/LinkDonorDialog/MarkSentDialog (all
 * imported, even though unmounted here) call useRouter() at module scope of
 * their own component function — mirroring the existing
 * search/page.test.ts mock convention.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import TxnDonorActions from "./txn-donor-actions";

describe("TxnDonorActions — Acknowledge button gate", () => {
  it("renders the Acknowledge button for a sub-$250 transaction when ackStatus is null", () => {
    const html = renderToStaticMarkup(
      <TxnDonorActions
        txnId="txn-1"
        amountCents={2000} // $20
        txnDate="2026-09-01"
        donorId={null}
        ackStatus={null}
      />,
    );

    expect(html).toContain("Acknowledge");
  });

  it("still renders the Acknowledge button for a $250+ transaction when ackStatus is null (unchanged happy path)", () => {
    const html = renderToStaticMarkup(
      <TxnDonorActions
        txnId="txn-2"
        amountCents={50000} // $500
        txnDate="2026-09-01"
        donorId={null}
        ackStatus={null}
      />,
    );

    expect(html).toContain("Acknowledge");
  });

  it("does not render the Acknowledge button once an acknowledgment already exists", () => {
    const html = renderToStaticMarkup(
      <TxnDonorActions
        txnId="txn-3"
        amountCents={2000}
        txnDate="2026-09-01"
        donorId={null}
        ackStatus="pending"
      />,
    );

    expect(html).not.toContain(">Acknowledge<");
    expect(html).toContain("Mark Sent");
  });
});

describe('TxnDonorActions mode="public" (Club Public Funds income row)', () => {
  it("shows Link donor and never Acknowledge, Mark Sent or Ack sent, whatever the ack status", () => {
    for (const ackStatus of [null, "pending", "sent"] as const) {
      const html = renderToStaticMarkup(
        <TxnDonorActions
          mode="public"
          txnId="txn-pub"
          amountCents={50000}
          txnDate="2026-09-01"
          donorId={null}
          ackStatus={ackStatus}
        />,
      );
      expect(html).toContain("Link donor");
      expect(html).not.toContain("Acknowledge");
      expect(html).not.toContain("Mark Sent");
      expect(html).not.toContain("Ack sent");
    }
  });

  it("offers Re-link once a donor is linked", () => {
    const html = renderToStaticMarkup(
      <TxnDonorActions mode="public" txnId="t" amountCents={100} txnDate="2026-09-01" donorId="d1" ackStatus={null} />,
    );
    expect(html).toContain("Re-link");
  });
});
