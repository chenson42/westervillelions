/** B-172: the transaction form's donor picker shows the chosen donor, the empty state, and Clear only when chosen. */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DonorPickerField from "./donor-picker-field";

describe("DonorPickerField", () => {
  it("empty: says no donor is chosen, offers Choose donor, no Clear", () => {
    const html = renderToStaticMarkup(<DonorPickerField donor={null} onChange={() => {}} />);
    expect(html).toContain("No donor chosen");
    expect(html).toContain("Choose donor");
    expect(html).not.toContain(">Clear<");
    expect(html).not.toContain("donor-chip");
  });

  it("chosen: shows the donor name chip, Change donor and Clear", () => {
    const html = renderToStaticMarkup(
      <DonorPickerField donor={{ id: "d1", name: "Pat Example" }} onChange={() => {}} />,
    );
    expect(html).toContain("donor-chip");
    expect(html).toContain("Pat Example");
    expect(html).toContain("Change donor");
    expect(html).toContain(">Clear<");
    expect(html).not.toContain("No donor chosen");
  });

  it("disabled while saving: Choose and Clear are disabled", () => {
    const html = renderToStaticMarkup(
      <DonorPickerField donor={{ id: "d1", name: "Pat Example" }} onChange={() => {}} disabled />,
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("every control meets the 44px target", () => {
    const html = renderToStaticMarkup(<DonorPickerField donor={null} onChange={() => {}} />);
    expect(html).toContain("min-h-[44px]");
  });
});

describe("DonorPickerField sits inside the transaction <form>", () => {
  it("stops the create-donor form's submit from bubbling (portal events follow the React tree)", () => {
    const src = readFileSync(path.join(__dirname, "donor-picker-field.tsx"), "utf8");
    expect(src).toMatch(/onSubmit=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});
