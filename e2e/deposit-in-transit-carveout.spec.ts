import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Deposit-in-Transit Carve-Out Symmetry — Phase 5 smoke coverage.
 *
 * Covers docs/work-log/2026-07-30-deposit-in-transit-carveout.md /
 * DECISION-059. This is read-only smoke coverage (no data mutation, nothing
 * to clean up) confirming the two surfaces touched by the fix render without
 * a runtime error: the new "Unremitted Deposits" panel on the admin Ledger
 * dashboard, and the member-facing monthly financial statement page whose
 * gate predicate changed. It does not assert on live financial figures —
 * those are covered by the unit tests in financial-report-queries.test.ts.
 */

test.describe("deposit-in-transit carve-out — smoke", () => {
  test("admin Ledger dashboard renders the Unremitted Deposits panel", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);

    // Act
    await page.goto("/admin/ledger");

    // Assert — panel heading present, positioned after Uncashed Checks, and
    // renders either its table or its empty state (both are valid — this is
    // a smoke test, not a data assertion).
    await expect(page.getByRole("heading", { name: "Unremitted Deposits" })).toBeVisible();
    const checksHeading = page.getByRole("heading", { name: "Uncashed Checks" });
    if (await checksHeading.isVisible()) {
      const checksBox = await checksHeading.boundingBox();
      const depositsBox = await page
        .getByRole("heading", { name: "Unremitted Deposits" })
        .boundingBox();
      if (checksBox && depositsBox) {
        expect(depositsBox.y).toBeGreaterThan(checksBox.y);
      }
    }

    // No Next.js runtime-error overlay / digest text
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test("member financial-reports page loads without a runtime error", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);

    // Act
    await page.goto("/members/financial-reports");

    // Assert
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.locator("h1")).toBeVisible();
  });
});
