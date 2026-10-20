import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import SweepBatchBuilder, { type SweepBatchBuilderProps } from "./sweep-batch-builder";
import SweepReviewPanel, { type SweepReviewPanelProps } from "./sweep-review-panel";
import { DEFAULT_FUND_LABELS } from "@/lib/ledger-fund-labels";
import {
  SWEEP_ERROR_COPY,
  SWEEP_ROW_FLAG_COPY,
  SWEEP_ROW_REFUSAL_COPY,
  type SweepCandidateRow,
  type SweepPreviewResponse,
  type SweepPreviewRow,
} from "@/lib/ledger-sweep";
import { SWEEP_FIFO_LINE } from "./sweep-builder-logic";

const LABELS = { ...DEFAULT_FUND_LABELS, activity: "Community Fund" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function cand(id: string, over: Partial<SweepCandidateRow> = {}): SweepCandidateRow {
  return {
    sourceId: id,
    giftDate: "2026-09-01",
    amountCents: 5000,
    party: "Example Donor",
    categoryName: "Donations",
    foundationCategoryName: "Foundation donations",
    hasDonor: true,
    ...over,
  };
}

function builder(over: Partial<SweepBatchBuilderProps> = {}) {
  const props: SweepBatchBuilderProps = {
    labels: LABELS,
    candidates: { eligible: [cand(A), cand(B, { hasDonor: false })], heldBack: [], inPendingBatch: [] },
    preselect: [],
    sourceAccounts: [{ id: "s", label: "Club Checking" }],
    destAccounts: [{ id: "d", label: "Foundation Checking" }],
    defaultSourceAccountId: "s",
    defaultDestAccountId: "d",
    today: "2026-10-19",
    canManage: false,
    closeouts: [],
    links: { sourceRegister: "/r1", destRegister: "/r2", approvals: "/admin/ledger/approvals" },
    ...over,
  };
  return renderToStaticMarkup(<SweepBatchBuilder {...props} />);
}

describe("select step", () => {
  it("lists each gift with a checkbox, the select-all, the total line and the FIFO line", () => {
    const html = builder();
    expect(html).toContain("Select all 2 gifts");
    expect(html).toContain(`id="sweep-gift-${A}"`);
    expect(html).toContain(`id="sweep-gift-${B}"`);
    expect(html).toContain("Goes to");
    expect(html).toContain("Foundation donations");
    expect(html).toContain(SWEEP_FIFO_LINE);
    expect(html).toContain("0</span> gifts selected");
    expect(html).toContain("Review sweep");
  });

  it("nudges about gifts with no donor record", () => {
    expect(builder()).toContain("1 gift has no donor record");
  });

  it("preselected gifts start checked and the running total shows", () => {
    const html = builder({ preselect: [A] });
    expect(html).toMatch(new RegExp(`id="sweep-gift-${A}"[^>]*checked`));
    expect(html).not.toMatch(new RegExp(`id="sweep-gift-${B}"[^>]*checked`));
    expect(html).toContain("1</span> gift selected");
    expect(html).toContain("$50.00");
  });

  it("says so when a preselected gift cannot be swept", () => {
    const html = builder({
      preselect: [A, C],
      candidates: {
        eligible: [cand(A)],
        heldBack: [{ row: cand(C), refusal: "no_mirror" }],
        inPendingBatch: [],
      },
    });
    expect(html).toContain("One of the gifts you came here with cannot be swept right now");
  });

  it("shows the held back list with the refusal copy", () => {
    const html = builder({
      candidates: {
        eligible: [cand(A)],
        heldBack: [{ row: cand(C), refusal: "manage_required" }],
        inPendingBatch: [],
      },
    });
    expect(html).toContain("Held back (1)");
    expect(html).toContain(SWEEP_ROW_REFUSAL_COPY.manage_required(LABELS));
  });

  it("names gifts that a pending batch holds", () => {
    const html = builder({ candidates: { eligible: [cand(A)], heldBack: [], inPendingBatch: [B, C] } });
    expect(html).toContain("2 gifts are in a batch waiting for board approval");
    expect(html).toContain("/admin/ledger/approvals");
  });

  it("shows the empty state with the fund's stored name", () => {
    const html = builder({ candidates: { eligible: [], heldBack: [], inPendingBatch: [] } });
    expect(html).toContain("bg-gray-50 rounded-2xl p-10 text-center text-gray-500");
    expect(html).toContain("No gifts are waiting to be swept");
    expect(html).toContain("Community Fund");
    expect(html).not.toContain("Public Funds");
  });

  it("offers closeout controls only to manage holders", () => {
    expect(builder()).not.toContain("Mark as already handled");
    const manage = builder({
      canManage: true,
      closeouts: [
        { sourceId: C, giftDate: "2026-08-01", amountCents: 2500, party: "Example Donor", categoryName: "Donations", reason: "Covered by the October transfer", closedAt: "2026-10-01T12:00:00.000Z" },
      ],
    });
    expect(manage).toContain("Mark as already handled");
    expect(manage).toContain("Marked as already handled (1)");
    expect(manage).toContain("Covered by the October transfer");
    expect(manage).toContain("Unmark");
  });

  it("uses the custom fund name and never the default one", () => {
    const html = builder({ candidates: { eligible: [], heldBack: [], inPendingBatch: [] } });
    expect(html).not.toContain(DEFAULT_FUND_LABELS.activity);
  });

  it("is the card layout below xl and a table from xl", () => {
    const html = builder();
    expect(html).toContain("block xl:table");
    expect(html).toContain("hidden xl:table-header-group");
    expect(html).toContain("rounded-2xl");
  });
});

function prow(over: Partial<SweepPreviewRow> = {}): SweepPreviewRow {
  return {
    sourceId: A,
    giftDate: "2026-09-01",
    amountCents: 5000,
    party: "Example Donor",
    categoryName: "Donations",
    foundationCategoryId: "cat-1",
    foundationCategoryName: "Foundation donations",
    foundationReceipt: "may_be_needed",
    receiptSentOn: null,
    flags: [],
    refusal: null,
    ...over,
  };
}

function pv(over: Partial<SweepPreviewResponse> = {}): SweepPreviewResponse {
  return {
    rows: [prow()],
    totalCents: 5000,
    count: 1,
    tier: "record",
    needsReason: false,
    status: "posted",
    thresholdCents: 10000,
    fiscalYears: [2026],
    sentStatementMonths: [],
    warnings: [],
    typedBankAmountCents: null,
    differenceCents: null,
    canPost: true,
    ...over,
  };
}

function review(over: Partial<SweepReviewPanelProps> = {}) {
  const props: SweepReviewPanelProps = {
    labels: LABELS,
    preview: pv(),
    loading: false,
    loadError: null,
    notice: null,
    sweepDate: "2026-10-19",
    today: "2026-10-19",
    onSweepDateChange: () => {},
    sourceAccounts: [{ id: "s", label: "Club Checking" }],
    destAccounts: [{ id: "d", label: "Foundation Checking" }],
    sourceAccountId: "s",
    destAccountId: "d",
    onSourceAccountChange: () => {},
    onDestAccountChange: () => {},
    bankAmountText: "",
    typedCents: null,
    onBankAmountChange: () => {},
    boardMinute: "",
    onBoardMinuteChange: () => {},
    priorYearReason: "",
    onReasonChange: () => {},
    submitting: false,
    canPostNow: false,
    onBack: () => {},
    onPost: () => {},
    onLeaveOutRefused: () => {},
    ...over,
  };
  return renderToStaticMarkup(<SweepReviewPanel {...props} />);
}

describe("review step", () => {
  it("shows totals, the category each gift goes to, the receipt note and the posted line", () => {
    const html = review();
    expect(html).toContain("Review the sweep");
    expect(html).toContain("$50.00");
    expect(html).toContain("Foundation donations");
    expect(html).toContain("The Foundation may need to send a receipt");
    expect(html).toContain("posts right away");
    expect(html).toContain("FY2026");
  });

  it("the date input has max = today (B5)", () => {
    expect(review()).toMatch(/id="sweep-date"[^>]*max="2026-10-19"/);
  });

  it("renders flags, warnings, sent-statement months and the already_sent receipt", () => {
    const html = review({
      preview: pv({
        rows: [prow({ flags: ["prior_fiscal_year", "no_donor"], foundationReceipt: "already_sent", receiptSentOn: "2026-03-04" })],
        warnings: [{ code: "exceeds_fund_balance", fundBalanceCents: 1000 }],
        sentStatementMonths: [{ month: "2026-03", addsCents: 5000 }],
        tier: "manage",
        needsReason: true,
      }),
    });
    expect(html).toContain(SWEEP_ROW_FLAG_COPY.prior_fiscal_year(LABELS));
    expect(html).toContain(SWEEP_ROW_FLAG_COPY.no_donor(LABELS).replace("'", "&#x27;"));
    expect(html).toContain("more than the Community Fund balance of $10.00");
    expect(html).toContain("March 2026");
    expect(html).toContain("A receipt was already sent on Mar 4, 2026.");
    expect(html).toContain("Manage Ledger");
    expect(html).toContain('id="sweep-prior-year-reason"');
  });

  it("an all-refused preview renders none of the tier, needs-reason or pending/posted text", () => {
    const html = review({
      preview: pv({
        rows: [prow({ refusal: "manage_required" })],
        count: 0,
        totalCents: 0,
        tier: "manage",
        needsReason: true,
        status: "pending",
        canPost: false,
      }),
    });
    expect(html).toContain(SWEEP_ROW_REFUSAL_COPY.manage_required(LABELS));
    expect(html).not.toContain("posts right away");
    expect(html).not.toContain("goes to the board");
    expect(html).not.toContain("Manage Ledger permission and a reason");
    expect(html).not.toContain("sweep-prior-year-reason");
    expect(html).toContain("Leave those gifts out");
  });

  it("a total above the integer limit shows the carrier copy and Post stays disabled", () => {
    const html = review({
      preview: pv({ totalCents: 2_147_483_648, canPost: false }),
      canPostNow: false,
    });
    expect(html).toContain(SWEEP_ERROR_COPY.total_too_large(LABELS));
    expect(html).toMatch(/<button type="submit" disabled[^>]*>Post sweep/);
  });

  it("the Posting state disables the button and explains the wait", () => {
    const html = review({ submitting: true, canPostNow: true });
    expect(html).toContain("Posting…");
    expect(html).toContain("up to half a minute");
    expect(html).toMatch(/<button type="submit" disabled/);
  });

  it("shows the live bank difference", () => {
    const html = review({ bankAmountText: "51", typedCents: 5100 });
    expect(html).toContain("That is $1.00 more than the selected gifts total.");
  });

  it("uses the custom fund name and not the default", () => {
    const html = review({ preview: pv({ warnings: [{ code: "unmatched_sources", count: 2 }] }) });
    expect(html).toContain("Community Fund");
    expect(html).not.toContain(DEFAULT_FUND_LABELS.activity);
  });
});

describe("sweep surfaces never use native dialogs", () => {
  it("no window.confirm/alert/prompt in any sweep-* component", () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => /^sweep-.*\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/);
    }
  });

  it("the builder posts through the controller and the confirm dialog, with no rounded-full button", () => {
    const src = readFileSync(join(__dirname, "sweep-batch-builder.tsx"), "utf8");
    expect(src).toContain("createSweepPostController");
    expect(src).toContain("<ConfirmDialog");
    expect(src).not.toContain("rounded-full");
  });
});
