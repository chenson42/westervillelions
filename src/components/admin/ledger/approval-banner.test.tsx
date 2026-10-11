/** The ?txn= banner and its Add your approval button. Node env: rendered statically. */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import ApprovalBanner from "./approval-banner";
import CosignDialog from "./cosign-dialog";

const COSIGN = {
  transactionId: "00000000-0000-4000-8000-000000000001",
  amountText: "$2,275.00",
  party: "Example Vendor",
  noun: "disbursement" as const,
  fundText: "Administrative Fund",
  memo: "Scoreboard repair",
  recorderName: "Sam Example",
  boardMinute: "Motion passed Oct 2026, minute 4",
};

describe("ApprovalBanner", () => {
  it("renders the Add your approval button only for the cosign action", () => {
    const withAction = renderToStaticMarkup(
      <ApprovalBanner model={{ tone: "success", text: "Approved by Pat.", action: "cosign" }} cosign={COSIGN} />,
    );
    expect(withAction).toContain("Add your approval");
    expect(withAction).toContain("min-h-[44px]");
    expect(withAction).toContain('role="status"');
    const without = renderToStaticMarkup(
      <ApprovalBanner model={{ tone: "success", text: "You added your approval." }} cosign={COSIGN} />,
    );
    expect(without).not.toContain("Add your approval</button>");
    expect(without).not.toContain("<button");
  });

  it("renders no button when the action has no dialog props", () => {
    const html = renderToStaticMarkup(
      <ApprovalBanner model={{ tone: "success", text: "x", action: "cosign" }} />,
    );
    expect(html).not.toContain("<button");
  });

  it("keeps the link and renders the text as plain React text", () => {
    const html = renderToStaticMarkup(
      <ApprovalBanner
        model={{
          tone: "success",
          text: "<b>x</b>",
          linkHref: "/admin/ledger/approvals?tab=decided&txn=1",
          linkLabel: "See everyone under Recently decided",
        }}
      />,
    );
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("See everyone under Recently decided");
  });
});

describe("CosignDialog trigger", () => {
  it("is a secondary rounded-lg button, not the primary fill", () => {
    const html = renderToStaticMarkup(<CosignDialog {...COSIGN} />);
    expect(html).toContain("border-2 border-lions-blue");
    expect(html).toContain("rounded-lg");
    expect(html).not.toContain("rounded-full");
    expect(html).toContain('type="button"');
  });
});
