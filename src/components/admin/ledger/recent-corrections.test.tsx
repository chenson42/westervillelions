/** Recent corrections section (Phase 3): states, copy and card (not table) layout. */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("RecentCorrections: corrected kind (B-108, T44)", () => {
  const corrected = (over: Partial<LedgerCorrectionRow> = {}) =>
    row({
      id: "c1",
      kind: "corrected",
      flow: "expense",
      from: null,
      to: null,
      reason: "Entered under the wrong category",
      changes: ["Bank account added: Admin Checking", "Category: Supplies to Postage", "Description edited"],
      ...over,
    });

  it("renders the Corrected badge and the changes list, never a Deleted or Moved badge", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[corrected()]} totalInWindow={1} />);
    expect(html).toContain("Corrected");
    expect(html).not.toContain("Deleted");
    expect(html).not.toContain("Moved");
    expect(html).toContain("Bank account added: Admin Checking");
    expect(html).toContain("Category: Supplies to Postage");
    expect(html).toContain("Description edited");
    expect(html).toContain("Entered under the wrong category");
    expect(html).toContain("$50.00 expense dated 2026-09-12");
  });

  it("never renders memo text (only the server-composed labels)", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections rows={[corrected({ changes: ["Description edited"] })]} totalInWindow={1} />,
    );
    expect(html).toContain("Description edited");
    expect(html).not.toContain("Supplies for the fall drive");
  });

  it("a corrected row without changes still renders as a card", () => {
    const html = renderToStaticMarkup(<RecentCorrections rows={[corrected({ changes: undefined })]} totalInWindow={1} />);
    expect(html).toContain("Corrected");
    expect(html).not.toContain("<ul class=\"mt-1 list-disc");
  });

  it("all three kinds render, each with its own badge", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections
        rows={[row({ id: "m", kind: "moved" }), row({ id: "d", kind: "deleted", from: null, to: null }), corrected()]}
        totalInWindow={3}
      />,
    );
    for (const label of ["Moved", "Deleted", "Corrected"]) expect(html).toContain(label);
  });

  it("keeps the settled-period badge on a corrected row", () => {
    const html = renderToStaticMarkup(
      <RecentCorrections rows={[corrected({ settledPeriod: true })]} totalInWindow={1} />,
    );
    expect(html).toContain("Settled period");
  });

  it("is exhaustive over the three kinds at compile time (a fourth kind must fail the build)", () => {
    const src = readFileSync(join(__dirname, "recent-corrections.tsx"), "utf8");
    expect(src).toContain("Record<CorrectionKind");
    expect(src).toContain("const unreachable: never = row.kind");
    expect(src).not.toMatch(/row\.kind === "moved" \? "Moved" : "Deleted"/);
  });
});
