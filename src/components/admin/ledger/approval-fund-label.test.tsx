import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ApprovalFundLabel from "./approval-fund-label";

describe("ApprovalFundLabel", () => {
  it("shows the entity name as secondary text for a plain fund", () => {
    const html = renderToStaticMarkup(
      <ApprovalFundLabel fund={{ kind: "plain", text: "Administrative Fund" }} entityName="Club" />,
    );
    expect(html).toContain("Administrative Fund");
    expect(html).toContain(">Club<");
  });

  it("shows it for a transfer but not for a sweep, whose text already names both books", () => {
    const transfer = renderToStaticMarkup(
      <ApprovalFundLabel fund={{ kind: "transfer", text: "A → B" }} entityName="Club" />,
    );
    expect(transfer).toContain(">Club<");
    const sweep = renderToStaticMarkup(
      <ApprovalFundLabel
        fund={{ kind: "sweep", text: "A (Foundation) → B (Club)" }}
        entityName="Foundation"
      />,
    );
    expect(sweep).toContain("A (Foundation) → B (Club)");
    expect(sweep).not.toContain(">Foundation<");
  });

  it("renders nothing extra without an entity name", () => {
    const html = renderToStaticMarkup(
      <ApprovalFundLabel fund={{ kind: "plain", text: "Administrative Fund" }} />,
    );
    expect(html).not.toContain("text-xs");
  });
});

describe("dialog copy is wired through the noun helpers (F1)", () => {
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
  it("no hard-coded disbursement titles, toasts or placeholders remain", () => {
    for (const f of ["approve-dialog.tsx"]) {
      const src = read(f);
      expect(src).not.toContain('title="Approve Disbursement"');
      expect(src).not.toContain('toast.success("Disbursement approved.")');
      expect(src).not.toContain("required to approve a disbursement");
    }
    const reject = read("reject-dialog.tsx");
    expect(reject).not.toContain('title="Reject Disbursement"');
    expect(reject).not.toContain('toast.success("Disbursement rejected.")');
    expect(reject).not.toContain("why this disbursement is being rejected");
  });
});
