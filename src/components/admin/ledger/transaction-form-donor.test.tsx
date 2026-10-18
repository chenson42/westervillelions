/** B-172: the donor picker appears on a NEW income gift into a public or Foundation fund only. */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LedgerFund, LedgerBankAccount } from "@/lib/db/schema";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import TransactionForm from "./transaction-form";

const fund = (id: string, kind: string, name: string) => ({ id, kind, name, isActive: true }) as unknown as LedgerFund;
const bank = { id: "b1", name: "Checking", isActive: true } as unknown as LedgerBankAccount;
const funds = [
  fund("f-admin", "administrative", "Administrative Fund"),
  fund("f-pub", "activity", "Community Money"),
  fund("f-char", "charitable", "Charitable Fund"),
];

function render(defaultFundId: string) {
  return renderToStaticMarkup(
    <TransactionForm
      entityId="e1"
      funds={funds}
      categories={[]}
      bankAccounts={[bank]}
      budgetLines={[]}
      defaultFundId={defaultFundId}
      onSuccess={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe("TransactionForm donor picker", () => {
  it("shows Choose donor for a Public Funds income gift", () => {
    expect(render("f-pub")).toContain("Choose donor");
  });
  it("shows Choose donor for a Foundation Charitable income gift", () => {
    expect(render("f-char")).toContain("Choose donor");
  });
  it("does not show it for the Administrative fund", () => {
    expect(render("f-admin")).not.toContain("Choose donor");
  });
  it("never prints the old fund name", () => {
    expect(render("f-pub")).not.toMatch(/\bActivity\b/);
  });
});
