/** DECISION-127: the guide sections read the stored fund names and never print the old name. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_FUND_LABELS, type FundLabels } from "@/lib/ledger-fund-labels";
import BooksRegisterSection from "./books-register-section";
import ZeffyFundRoutingSection from "./zeffy-fund-routing-section";
import BudgetingSection from "./budgeting-section";
import GuardrailsSection from "./guardrails-section";
import SettingsSection from "./settings-section";
import ItemizedSweepSection from "./itemized-sweep-section";
import { SWEEP_FIFO_LINE } from "../sweep-builder-logic";

const CUSTOM: FundLabels = { ...DEFAULT_FUND_LABELS, activity: "Community Money" };
const text = (el: React.ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|&ldquo;|&rdquo;/g, "'").replace(/\s+/g, " ");

const sections: Array<[string, (l: FundLabels) => React.ReactElement]> = [
  ["books-register", (l) => <BooksRegisterSection labels={l} />],
  ["zeffy-fund-routing", (l) => <ZeffyFundRoutingSection labels={l} />],
  ["budgeting", (l) => <BudgetingSection labels={l} />],
  ["guardrails", (l) => <GuardrailsSection labels={l} />],
  ["settings", (l) => <SettingsSection settings={null} labels={l} />],
  ["itemized-sweep", (l) => <ItemizedSweepSection labels={l} />],
];

describe("Treasury guide fund labels", () => {
  for (const [name, render] of sections) {
    it(`${name}: renders a custom activity name and contains no "Activity" word`, () => {
      const t = text(render(CUSTOM));
      expect(t).toContain("Community Money");
      expect(t).not.toMatch(/\bActivity\b/);
    });
    it(`${name}: the default labels read "Public Funds"`, () => {
      expect(text(render(DEFAULT_FUND_LABELS))).toContain("Public Funds");
    });
  }

  it("keeps the Lions International \"Activities account\" term findable", () => {
    expect(text(<BooksRegisterSection labels={DEFAULT_FUND_LABELS} />)).toContain("Activities account");
  });

  it("guardrails: the firewall and admin-public-income rows use the stored names", () => {
    const t = text(<GuardrailsSection labels={CUSTOM} />);
    expect(t).toContain("Community Money money must never move into Administrative Fund");
    expect(t).toContain("Reclassify to Community Money or Charitable Fund");
  });

  it("itemized-sweep: covers batches, review, approval, void, closeout, the FIFO wording and the match picker", () => {
    const t = text(<ItemizedSweepSection labels={CUSTOM} />);
    for (const phrase of [
      "Sweeping to the Foundation",
      "Held back",
      "amount that reached the bank",
      "individual gifts cannot be decided separately",
      "An approved batch cannot be voided",
      "Record a correcting entry on each book",
      "already handled",
      "Match this batch",
      "Swept from Community Money",
      SWEEP_FIFO_LINE,
    ]) {
      expect(t).toContain(phrase);
    }
    expect(t).toMatch(/says\W+Emailed\W+, never\W+Delivered/);
  });

  it("the flipped sentences are gone from the register and Zeffy sections (B17)", () => {
    for (const el of [<BooksRegisterSection key="b" labels={CUSTOM} />, <ZeffyFundRoutingSection key="z" labels={CUSTOM} />]) {
      const t = text(el);
      expect(t).not.toMatch(/lump amount|lump sweep|Sweep to Foundation form|two linked entries/i);
      expect(t).not.toContain("with no donor attached");
    }
    const b = text(<BooksRegisterSection labels={CUSTOM} />);
    expect(b).toContain("Sweep to the Foundation page with that gift already ticked");
    expect(text(<ZeffyFundRoutingSection labels={CUSTOM} />)).toContain("How a sweep works");
  });
});
