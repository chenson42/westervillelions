/** B-172: the Foundation-bound hint renders every MirrorHint state (and nothing when not applicable). */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FoundationBoundHint from "./foundation-bound-hint";
import { describeMirrorHint, type MirrorHint } from "@/lib/ledger-category-mirror";
import { ACK_MIN_CENTS } from "@/lib/ledger";
import { DEFAULT_FUND_LABELS } from "@/lib/ledger-fund-labels";

const render = (hint: MirrorHint, labels = DEFAULT_FUND_LABELS) =>
  renderToStaticMarkup(<FoundationBoundHint hint={hint} labels={labels} />);

describe("FoundationBoundHint", () => {
  it("renders nothing when the category is not a Public Funds income category", () => {
    expect(render({ state: "not_applicable" })).toBe("");
  });

  it("bound with a receipt: names the Foundation category and says a receipt will be needed", () => {
    const html = render({ state: "bound", foundationCategoryName: "Public donations", receipt: "may_be_needed" });
    expect(html).toContain("Foundation-bound");
    expect(html).toContain("Public donations");
    expect(html).toContain("a written receipt will be needed");
    expect(html).toContain('data-hint-state="bound"');
  });

  it("bound without a receipt: says no receipt is needed", () => {
    const html = render({ state: "bound", foundationCategoryName: "White Cane", receipt: "not_needed" });
    expect(html).toContain("No written acknowledgment is required");
  });

  it("stays, no counterpart: reads the stored fund name, not a literal", () => {
    const html = render(
      { state: "stays", reason: "no_mirror" },
      { ...DEFAULT_FUND_LABELS, activity: "Community Money" },
    );
    expect(html).toContain("staying in Community Money");
    expect(html).not.toContain("Activity");
  });

  it("stays, counterpart deactivated", () => {
    const html = render({ state: "stays", reason: "mirror_inactive" });
    expect(html).toContain("deactivated");
    expect(html).toContain("staying in Public Funds");
  });

  it("end to end with describeMirrorHint: a gift under the receipt threshold needs no receipt", () => {
    const category = { fundKind: "activity", flow: "income", entityDonationsDeductible: false };
    const mirror = { name: "Public donations", isActive: true, ackNotRequired: false };
    expect(render(describeMirrorHint(category, mirror, ACK_MIN_CENTS - 1))).toContain("No written acknowledgment is required");
    expect(render(describeMirrorHint(category, mirror, ACK_MIN_CENTS))).toContain("a written receipt will be needed");
  });
});
