import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { SweepCloseoutBody, isCloseoutSubmittable, type SweepCloseoutBodyProps } from "./sweep-closeout-dialog";
import { UNMARK_DESCRIPTION } from "./sweep-unmark-confirm";
import SweepUnmarkConfirm from "./sweep-unmark-confirm";
import { DEFAULT_FUND_LABELS } from "@/lib/ledger-fund-labels";
import { REASON_LIMITS, SWEEP_CLOSEOUT_SKIP_COPY, type SweepCloseoutSkip } from "@/lib/ledger-sweep";

const LABELS = { ...DEFAULT_FUND_LABELS, activity: "Community Fund" };
const ID = "11111111-1111-4111-8111-111111111111";

function body(over: Partial<SweepCloseoutBodyProps> = {}) {
  const props: SweepCloseoutBodyProps = {
    labels: LABELS,
    count: 2,
    reason: "",
    submitting: false,
    error: null,
    skipped: null,
    onReasonChange: () => {},
    onConfirm: () => {},
    onCancel: () => {},
    ...over,
  };
  return renderToStaticMarkup(<SweepCloseoutBody {...props} />);
}

describe("SweepCloseoutBody reason gating", () => {
  it("needs a reason inside the carrier's limits", () => {
    expect(isCloseoutSubmittable("")).toBe(false);
    expect(isCloseoutSubmittable("x".repeat(REASON_LIMITS.min - 1))).toBe(false);
    expect(isCloseoutSubmittable("x".repeat(REASON_LIMITS.min))).toBe(true);
    expect(isCloseoutSubmittable("x".repeat(REASON_LIMITS.max + 1))).toBe(false);
  });

  it("disables the button until the reason is valid and says not to type a name", () => {
    expect(body()).toMatch(/<button type="submit" disabled[^>]*>Mark as already handled/);
    const ok = body({ reason: "Covered by the October transfer" });
    expect(ok).not.toMatch(/<button type="submit" disabled/);
    expect(ok).toContain("Do not type a donor");
    expect(ok).toContain("These 2 gifts");
  });

  it("says Saving while submitting and shows a server error inline", () => {
    const html = body({ reason: "Covered by the October transfer", submitting: true, error: "Nope." });
    expect(html).toContain("Saving…");
    expect(html).toContain("Nope.");
  });
});

describe("SweepCloseoutBody skipped gifts", () => {
  it("renders the carrier sentence for every skip code, with the stored fund name", () => {
    const codes: SweepCloseoutSkip[] = [
      "not_found", "wrong_fund", "not_income", "not_posted",
      "transfer_leg", "already_swept", "already_closed_out", "not_closed_out",
    ];
    const html = body({ skipped: codes.map((code, i) => ({ sourceId: `id-${i}`, code })) });
    for (const code of codes) {
      expect(html).toContain(SWEEP_CLOSEOUT_SKIP_COPY[code](LABELS));
    }
    expect(html).toContain("Community Fund");
    expect(html).not.toContain(DEFAULT_FUND_LABELS.activity);
    expect(html).toContain(">Done<");
  });
});

describe("SweepUnmarkConfirm", () => {
  it("renders a 44px Unmark button named for the gift and keeps the confirm closed", () => {
    const html = renderToStaticMarkup(
      <SweepUnmarkConfirm sourceId={ID} summary="Example Donor, Aug 1, 2026, $25.00" labels={LABELS} />,
    );
    expect(html).toContain("Unmark");
    expect(html).toContain('aria-label="Unmark Example Donor, Aug 1, 2026, $25.00"');
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toContain(UNMARK_DESCRIPTION);
  });

  it("the confirmation says the gift is offered again and nothing else changes", () => {
    expect(UNMARK_DESCRIPTION).toContain("offered for a sweep");
    expect(UNMARK_DESCRIPTION).toContain("Nothing else changes");
  });
});
