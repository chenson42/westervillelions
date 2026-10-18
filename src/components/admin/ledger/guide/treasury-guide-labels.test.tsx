/** DECISION-127: the guide sections read the stored fund names and never print the old name. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_FUND_LABELS, type FundLabels } from "@/lib/ledger-fund-labels";
import BooksRegisterSection from "./books-register-section";
import ZeffyFundRoutingSection from "./zeffy-fund-routing-section";
import BudgetingSection from "./budgeting-section";
import GuardrailsSection from "./guardrails-section";
import SettingsSection from "./settings-section";

const CUSTOM: FundLabels = { ...DEFAULT_FUND_LABELS, activity: "Community Money" };
const text = (el: React.ReactElement) =>
  renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|&ldquo;|&rdquo;/g, "'").replace(/\s+/g, " ");

const sections: Array<[string, (l: FundLabels) => React.ReactElement]> = [
  ["books-register", (l) => <BooksRegisterSection labels={l} />],
  ["zeffy-fund-routing", (l) => <ZeffyFundRoutingSection labels={l} />],
  ["budgeting", (l) => <BudgetingSection labels={l} />],
  ["guardrails", (l) => <GuardrailsSection labels={l} />],
  ["settings", (l) => <SettingsSection settings={null} labels={l} />],
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
});
