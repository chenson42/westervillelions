/** Recent corrections section (Phase 3): states, copy and card (not table) layout. */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RecentCorrections from "./recent-corrections";
import type { LedgerCorrectionRow } from "@/lib/ledger-correction";

function row(over: Partial<LedgerCorrectionRow> = {}): LedgerCorrectionRow {
  return {
    id: "r1",
    createdAt: new Date("2026-10-01T15:00:00Z"),
    actorName: "Pat Treasurer",
    kind: "moved",
    amountCents: 5000,
    flow: "income",
    txnDate: "2026-09-12",
    from: "Administrative Fund",
    to: "Activity Fund",
    reason: "Booked to the wrong fund",
    settledPeriod: false,
    rowCount: 1,
    sentStatementMonth: null,
    crossEntity: false,
    fromEntityName: null,
    toEntityName: null,
    fromBankAccount: null,
    toBankAccount: null,
    receiptSent: false,
    ...over,
  };
}

describe("RecentCorrections", () => {
  it("empty state uses the standard empty-state card", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[]} totalInWindow={0} />);
    expect(html).toContain("No corrections in the last 90 days.");
    expect(html).toContain("bg-gray-50 rounded-2xl p-10 text-center text-gray-500");
  });

  it("load failure renders a small note instead of an empty state", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[]} totalInWindow={0} loadFailed />);
    expect(html).toContain("Corrections could not be loaded.");
    expect(html).not.toContain("No corrections");
  });

  it("a move shows badge, amount, from/to, reason, actor and date as a stacked card", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[row()]} totalInWindow={1} />);
    expect(html).toContain("Moved");
    expect(html).toContain("$50.00");
    expect(html).toContain("from Administrative Fund to Activity Fund");
    expect(html).toContain("Booked to the wrong fund");
    expect(html).toContain("Pat Treasurer");
    expect(html).toContain("Oct 1, 2026");
    expect(html).toContain("rounded-2xl");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Settled period");
    expect(html).not.toContain("Showing the");
  });

  it("badges: Settled period, Statement already sent, and 2 entries for a pair", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections
        rows={[row({ kind: "deleted", to: null, settledPeriod: true, sentStatementMonth: "2026-09", rowCount: 2 })]}
        totalInWindow={1}
      />,
    );
    expect(html).toContain("Deleted");
    expect(html).toContain("Settled period");
    expect(html).toContain("Statement already sent (September 2026)");
    expect(html).toContain("2 entries");
  });

  it("an unparseable legacy row is still listed with a placeholder reason", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections rows={[row({ amountCents: null, reason: null, from: null, to: null })]} totalInWindow={1} />,
    );
    expect(html).toContain("Not recorded (older log entry).");
    expect(html).toContain("Amount unavailable");
  });

  it("truncated lists say how many of the total are shown", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[row()]} totalInWindow={40} />);
    expect(html).toContain("Showing the 1 most recent of 40 in the last 90 days.");
  });

  it("C41: a cross-entity move reads 'Foundation to Club' with both accounts and 'Receipt already sent'", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections
        rows={[
          row({
            from: "Charitable Fund",
            to: "Activity Fund",
            crossEntity: true,
            fromEntityName: "Foundation",
            toEntityName: "Club",
            fromBankAccount: "Foundation Checking",
            toBankAccount: "Administrative Checking",
            receiptSent: true,
          }),
        ]}
        totalInWindow={1}
      />,
    );
    expect(html).toContain("Foundation to Club");
    expect(html).toContain("Foundation Checking to Administrative Checking");
    expect(html).toContain("Receipt already sent");
    expect(html).toContain("from Charitable Fund to Activity Fund");
  });

  it("C41: a same-entity (v1) card is unchanged: no entity badge, no bank line, no receipt badge", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[row()]} totalInWindow={1} />);
    expect(html).not.toContain(" to Club");
    expect(html).not.toContain("Bank account:");
    expect(html).not.toContain("Receipt already sent");
  });

  it("C41: a cross-entity move without a sent receipt has no receipt badge", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections
        rows={[row({ crossEntity: true, fromEntityName: "Foundation", toEntityName: "Club" })]}
        totalInWindow={1}
      />,
    );
    expect(html).toContain("Foundation to Club");
    expect(html).not.toContain("Receipt already sent");
  });
});
