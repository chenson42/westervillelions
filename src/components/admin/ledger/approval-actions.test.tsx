/**
 * The shared Approve / Reject block (used by the table row and the card).
 * Node env: rendered statically, same approach as delete-transaction-dialog.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ApprovalActions from "./approval-actions";
import ApprovalCard from "./approval-card";

const base = {
  transactionId: "00000000-0000-4000-8000-000000000001",
  amount: "$2,275.00",
  party: "Example Vendor",
  memo: "Scoreboard repair",
  existingBoardMinute: null,
  fund: { kind: "plain" as const, text: "Administrative Fund" },
  recordedBy: "Sam Example",
};

describe("ApprovalActions", () => {
  it("renders Approve and Reject with 44px targets on someone else's row", () => {
    const html = renderToStaticMarkup(<ApprovalActions {...base} isSelf={false} />);
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
    expect(html.match(/min-h-\[44px\]/g)?.length).toBe(2);
    expect(html).not.toContain("rounded-full");
  });

  it("on the viewer's own row hides Reject (not just disables) and Approve, and says why", () => {
    const html = renderToStaticMarkup(<ApprovalActions {...base} isSelf />);
    expect(html).not.toContain("Reject");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("<button");
    expect(html).toContain("You recorded this, so another board member must decide it.");
  });
});

describe("ApprovalCard", () => {
  it("carries data-row-id and never a DOM id", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard {...base} dateText="Oct 10, 2026" isSelf={false} />,
    );
    expect(html).toContain(`data-row-id="${base.transactionId}"`);
    expect(html).not.toMatch(/<li[^>]*\sid=/);
    expect(html).toContain("rounded-2xl");
    expect(html).toContain("Scoreboard repair");
  });

  it("shows a Transfer chip with from to for a pair", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard
        {...base}
        dateText="Oct 10, 2026"
        isSelf={false}
        fund={{ kind: "transfer", text: "Admin Fund → Activity Fund" }}
      />,
    );
    expect(html).toContain("Transfer");
    expect(html).toContain("Admin Fund → Activity Fund");
  });
});

describe("ApprovalCard: an itemized sweep batch (B-172 Inc 2b, B8)", () => {
  const detail = {
    count: 3,
    totalCents: 31000,
    sweepDate: "2026-10-12",
    earliestGiftDate: "2026-09-02",
    latestGiftDate: "2026-09-28",
    fiscalYears: [2026],
    byCategory: [
      { name: "Public donations", count: 2, cents: 25000 },
      { name: "White Cane", count: 1, cents: 6000 },
    ],
    recordedBy: "Sam Example",
    boardMinute: "Motion passed Oct 2026",
  };
  const batchProps = {
    ...base,
    party: "",
    memo: "Itemized sweep: 3 gifts",
    amount: "$310.00",
    fund: { kind: "sweep" as const, text: "Public Funds \u2192 Foundation" },
    batchCount: 3,
  };

  it("shows the summary once, in place of the payee and memo lines, with the shared Approve and Reject", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard {...batchProps} dateText="Oct 12, 2026" isSelf={false} batch={detail} />,
    );
    expect(html.match(/data-testid="sweep-batch-summary"/g)?.length).toBe(1);
    expect(html).toContain("Itemized sweep: 3 gifts");
    expect(html).toContain("3 gifts, $310.00");
    expect(html).toContain("Gifts dated Sep 2, 2026 to Sep 28, 2026");
    expect(html).toContain("Public donations: 2 gifts, $250.00");
    expect(html).toContain("Minute:");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
    // The card keeps its own Recorded by line; the summary does not repeat it.
    expect(html.match(/Recorded by/g)?.length).toBe(1);
  });

  it("without a loaded summary it still renders the generated memo and the actions (a failed read never drops the row)", () => {
    const html = renderToStaticMarkup(
      <ApprovalCard {...batchProps} dateText="Oct 12, 2026" isSelf={false} batch={null} />,
    );
    expect(html).toContain("Itemized sweep: 3 gifts");
    expect(html).toContain(">Approve<");
  });

  it("the Approve and Reject dialogs take the batch count and use describeBatchDecision", () => {
    for (const file of ["approve-dialog.tsx", "reject-dialog.tsx", "approval-actions.tsx"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).toContain("batchCount");
    }
    expect(readFileSync(join(__dirname, "approve-dialog.tsx"), "utf8")).toContain('describeBatchDecision("approve"');
    expect(readFileSync(join(__dirname, "reject-dialog.tsx"), "utf8")).toContain('describeBatchDecision("reject"');
  });
});
