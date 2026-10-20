/** B-172 Increment 2b, B8: the batch summary shared by the Approvals card, row and batch dialog. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SweepBatchSummary, { type SweepBatchSummaryData } from "./sweep-batch-summary";

const DATA: SweepBatchSummaryData = {
  count: 3,
  totalCents: 31000,
  sweepDate: "2026-10-12",
  earliestGiftDate: "2026-09-02",
  latestGiftDate: "2026-09-28",
  fiscalYears: [2025, 2026],
  byCategory: [
    { name: "Public donations", count: 2, cents: 25000 },
    { name: "White Cane", count: 1, cents: 6000 },
  ],
  recordedBy: "Sam Example",
  boardMinute: "Motion passed Oct 2026",
};

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("SweepBatchSummary", () => {
  it("renders the memo, count, total, sweep date, gift-date span, fiscal years, category lines, minute and recorder", () => {
    const t = text(renderToStaticMarkup(<SweepBatchSummary data={DATA} />));
    expect(t).toContain("Itemized sweep: 3 gifts");
    expect(t).toContain("3 gifts, $310.00. Sweep dated Oct 12, 2026.");
    expect(t).toContain("Gifts dated Sep 2, 2026 to Sep 28, 2026 (FY2025, FY2026)");
    expect(t).toContain("Public donations: 2 gifts, $250.00");
    expect(t).toContain("White Cane: 1 gift, $60.00");
    expect(t).toContain("Minute: Motion passed Oct 2026");
    expect(t).toContain("Recorded by Sam Example");
  });

  it("the card and the table row render the same fields (the row only drops the recorder, which has its own column)", () => {
    const card = text(renderToStaticMarkup(<SweepBatchSummary data={DATA} showRecorder />));
    const row = text(renderToStaticMarkup(<SweepBatchSummary data={DATA} showRecorder={false} />));
    expect(row).not.toContain("Recorded by");
    expect(card.replace(" Recorded by Sam Example", "")).toBe(row);
  });

  it("says 'Gift dated' for a one-day span and the singular for one gift", () => {
    const t = text(
      renderToStaticMarkup(
        <SweepBatchSummary
          data={{ ...DATA, count: 1, totalCents: 5000, earliestGiftDate: "2026-09-02", latestGiftDate: "2026-09-02", byCategory: [{ name: "Public donations", count: 1, cents: 5000 }] }}
        />,
      ),
    );
    expect(t).toContain("Itemized sweep: 1 gift");
    expect(t).toContain("Gift dated Sep 2, 2026");
    expect(t).not.toContain(" to Sep");
  });

  it("shows no party, memo or donor even when an object carrying them is passed through a cast", () => {
    const wider = {
      ...DATA,
      party: "Zelda Fixture",
      memo: "Private note about a family",
      donorId: "donor-id-1",
      donorName: "Quentin Fixture",
      gifts: [{ party: "Zelda Fixture", amountCents: 1000 }],
    } as unknown as SweepBatchSummaryData;
    const html = renderToStaticMarkup(<SweepBatchSummary data={wider} />);
    for (const secret of ["Zelda", "Private note", "donor-id-1", "Quentin"]) expect(html).not.toContain(secret);
  });

  it("its prop type names no party, memo or donor field", () => {
    // Compile-time too (Pick of the detail), asserted here against the source.
    const keys: Array<keyof SweepBatchSummaryData> = [
      "count", "totalCents", "sweepDate", "earliestGiftDate", "latestGiftDate",
      "fiscalYears", "byCategory", "recordedBy", "boardMinute",
    ];
    expect(keys.some((k) => /party|memo|donor/i.test(k))).toBe(false);
  });
});
