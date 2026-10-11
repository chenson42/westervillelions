/** Recently decided list. Node env: rendered statically. */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
import { renderToStaticMarkup } from "react-dom/server";
import type { DecidedApprovalRow } from "@/lib/ledger-approval";
import ApprovalHistory, { deciderLabel } from "./approval-history";

const BASE = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "disbursement" as const,
  decidedAt: "2026-10-10T19:42:00.000Z",
  deciderName: "Pat Example",
  deciderIsViewer: false,
  amountCents: 227500,
  txnDate: "2026-10-03",
  party: "Example Vendor",
  memo: "Scoreboard repair",
  fundName: "Administrative Fund",
  partnerFundName: null,
  entityId: "e1",
  partnerEntityId: null,
  entityName: "Club",
  partnerEntityName: null,
  recorderName: "Sam Example",
};

const approved = (over: Partial<Extract<DecidedApprovalRow, { decision: "approved" }>> = {}) =>
  ({
    ...BASE,
    decision: "approved",
    boardMinute: "Motion passed Oct 2026, minute 4",
    cosigners: [],
    canCosign: false,
    viewerHasCosigned: false,
    viewerRecorded: false,
    ...over,
  }) as DecidedApprovalRow;
const rejected = (over: Partial<Extract<DecidedApprovalRow, { decision: "rejected" }>> = {}) =>
  ({
    ...BASE,
    id: "00000000-0000-4000-8000-000000000002",
    decision: "rejected",
    deciderOnFile: true,
    rejectionReason: "Over budget for this quarter",
    ...over,
  }) as DecidedApprovalRow;

const render = (props: Parameters<typeof ApprovalHistory>[0]) =>
  renderToStaticMarkup(<ApprovalHistory {...props} />);

describe("deciderLabel", () => {
  it("names the decision and the decider", () => {
    expect(deciderLabel(approved())).toBe("Approved by Pat Example");
    expect(deciderLabel(rejected({ deciderName: "Lee Example" }))).toBe("Rejected by Lee Example");
  });
  it("says You for the viewer", () => {
    expect(deciderLabel(approved({ deciderIsViewer: true }))).toBe("Approved by You");
    expect(deciderLabel(rejected({ deciderIsViewer: true }))).toBe("Rejected by You");
  });
  it("falls back to a board member when no name is on file", () => {
    expect(deciderLabel(approved({ deciderName: null }))).toBe("Approved by a board member");
    expect(deciderLabel(rejected({ deciderName: null }))).toBe("Rejected by a board member");
  });
  it("reports a legacy rejection as decider not on file", () => {
    expect(deciderLabel(rejected({ deciderOnFile: false, deciderName: null }))).toBe(
      "Rejected, decider not on file",
    );
  });
});

describe("ApprovalHistory", () => {
  it("renders an approved card with badge, formatted amount, Eastern time and the full minute", () => {
    const html = render({ rows: [approved()] });
    expect(html).toContain("Approved");
    expect(html).toContain("bg-green-100");
    expect(html).toContain("$2,275.00");
    expect(html).toContain("Oct 10, 2026 at 3:42 PM");
    expect(html).toContain("Approved by Pat Example");
    expect(html).toContain("Motion passed Oct 2026, minute 4");
    expect(html).toContain("Recorded by");
    expect(html).toContain("Example Vendor");
    expect(html).toContain("Scoreboard repair");
    expect(html).toContain("break-words");
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("renders a rejected card with a gray badge and the reason in full", () => {
    const long = "x".repeat(900);
    const html = render({ rows: [rejected({ rejectionReason: long })] });
    expect(html).toContain("bg-gray-200");
    expect(html).toContain("Rejected by Pat Example");
    expect(html).toContain(long);
    expect(html).not.toContain("title=");
  });

  it("shows decider not on file for a legacy rejection", () => {
    const html = render({ rows: [rejected({ deciderOnFile: false, deciderName: null })] });
    expect(html).toContain("Rejected, decider not on file");
  });

  it("shows You for the viewer's own decision", () => {
    expect(render({ rows: [approved({ deciderIsViewer: true })] })).toContain("Approved by You");
  });

  it("names the entity on a plain row and both entities on a sweep", () => {
    expect(render({ rows: [approved()] })).toContain("Club");
    const sweep = approved({
      kind: "sweep",
      fundName: "Charitable Fund",
      partnerFundName: "Activity Fund",
      entityId: "e2",
      partnerEntityId: "e1",
      entityName: "Foundation",
      partnerEntityName: "Club",
    });
    const html = render({ rows: [sweep] });
    expect(html).toContain("Charitable Fund (Foundation)");
    expect(html).toContain("Activity Fund (Club)");
  });

  it("gives every card data-row-id and no DOM id", () => {
    const html = render({ rows: [approved(), rejected()] });
    expect(html.match(/data-row-id="/g)?.length).toBe(2);
    expect(html).not.toMatch(/\sid="/);
  });

  it("server-renders the highlight ring and tabIndex on the target only", () => {
    const html = render({ rows: [approved(), rejected()], highlightId: BASE.id });
    expect(html.match(/ring-lions-gold/g)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/g)?.length).toBe(1);
    expect(html).toContain("scroll-mt-24");
  });

  it("carries the footnote with register and search links", () => {
    const html = render({ rows: [approved()] });
    expect(html).toContain("Showing the 25 most recent decisions.");
    expect(html).toContain('href="/admin/ledger"');
    expect(html).toContain('href="/admin/ledger/search"');
  });

  it("renders the empty state", () => {
    const html = render({ rows: [] });
    expect(html).toContain("No disbursements have been approved or rejected yet.");
    expect(html).toContain("bg-gray-50");
    expect(html).toContain("rounded-2xl");
  });

  it("renders the failure state with a reload link", () => {
    const html = render({ rows: [], failed: true });
    expect(html).toContain("Could not load recent decisions. Try again in a moment.");
    expect(html).toContain('href="/admin/ledger/approvals?tab=decided"');
  });

  it("uses rounded-2xl cards and never a rounded-full badge", () => {
    const html = render({ rows: [approved()] });
    expect(html).toContain("rounded-2xl");
    expect(html).not.toContain("rounded-full");
  });

  it("escapes user-typed text", () => {
    const html = render({ rows: [approved({ party: "<script>alert(1)</script>" })] });
    expect(html).not.toContain("<script>");
  });

  describe("co-signs (2b)", () => {
    const cs = (name: string | null, isViewer = false, cosignedAt = "2026-10-11T15:00:00.000Z") => ({
      name,
      isViewer,
      cosignedAt,
    });

    it("shows the help line on the list", () => {
      expect(render({ rows: [approved()] })).toContain(
        "These are already posted. You can add your approval to any entry you did not record.",
      );
    });

    it("renders Also approved by only when co-signers exist, never 'none'", () => {
      const none = render({ rows: [approved()] });
      expect(none).not.toContain("Also approved by");
      expect(none).not.toMatch(/None|no one/);
      const html = render({ rows: [approved({ cosigners: [cs("Ann Example")] })] });
      expect(html).toContain("Also approved by:");
      expect(html).toContain("Ann Example (Oct 11)");
    });

    it("renders every name (no cap) and the viewer as You", () => {
      const many = Array.from({ length: 13 }, (_, i) => cs(`Member ${String.fromCharCode(65 + i)}`));
      const html = render({ rows: [approved({ cosigners: [...many, cs("Me", true)] })] });
      for (let i = 0; i < 13; i++) expect(html).toContain(`Member ${String.fromCharCode(65 + i)}`);
      expect(html).toContain("You (Oct 11)");
      expect(html).not.toContain(" others");
    });

    it("renders the Add your approval button only when canCosign", () => {
      expect(render({ rows: [approved({ canCosign: true })] })).toContain("Add your approval");
      expect(render({ rows: [approved({ canCosign: false })] })).not.toContain(">Add your approval<");
    });

    it("shows the already-added and recorded states without a button", () => {
      const added = render({ rows: [approved({ viewerHasCosigned: true, cosigners: [cs("Me", true)] })] });
      expect(added).toContain("You added your approval.");
      expect(added).not.toContain(">Add your approval<");
      const rec = render({ rows: [approved({ viewerRecorded: true })] });
      expect(rec).toContain("You recorded this, so another board member decides it.");
      expect(rec).not.toContain(">Add your approval<");
    });

    it("rejected cards have no approvals line, no button and no co-sign states", () => {
      const html = render({ rows: [rejected()] });
      expect(html).not.toContain("Also approved by");
      expect(html).not.toContain("Add your approval");
      expect(html).not.toContain("You added your approval");
    });

    it("never prints a fraction of the board, votes or an email", () => {
      const html = render({ rows: [approved({ cosigners: [cs("Ann Example"), cs(null)] })] });
      expect(html).not.toMatch(/votes|\d+ of \d+|@/);
    });

    it("keeps the button a 44px rounded-lg control", () => {
      const html = render({ rows: [approved({ canCosign: true })] });
      expect(html).toContain("min-h-[44px]");
      expect(html).toContain("rounded-lg");
    });
  });
});
