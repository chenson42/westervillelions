/**
 * The shared Approve / Reject block (used by the table row and the card).
 * Node env: rendered statically, same approach as delete-transaction-dialog.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
