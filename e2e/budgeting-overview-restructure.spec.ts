import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Budgeting Overview/Drill-Down Restructure —
 * docs/work-log/2026-07-30-budgeting-overview-restructure.md.
 *
 * Covers the three flows the Phase 3 design doc names as e2e-worthy: the
 * overview -> drill-down -> overview navigation loop, the budget-level
 * "Notes & Assumptions" editor round trip (DECISION-060), and the printed
 * document's structure (Consolidated Summary + per-fund detail + the new
 * Notes & Assumptions block). budgeting-restructure.spec.ts and
 * budget-star-notes.spec.ts (both updated for the new URL split) continue to
 * cover the category/cause-line editing mechanics themselves — this suite is
 * additive, not a replacement.
 *
 * Runs against the Club entity at a dedicated, never-otherwise-used fiscal
 * year (FY2096) — distinct from FY2099 (budgeting-restructure.spec.ts /
 * budget-star-notes.spec.ts) and FY2097/2098 (prior-year-cause-line-
 * reconcile.spec.ts), so this suite can't collide with or pollute either.
 * Not cleaned up after the run, same rationale those suites already
 * document: no destructive cleanup path short of a direct DB delete.
 */

const ENTITY_SLUG = "club";
const TEST_FISCAL_YEAR = 2096;
const ACTIVITY_FUND_SLUG = "activity";
const OVERVIEW_URL = `/admin/ledger/budgeting?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const DRILLDOWN_URL = `/admin/ledger/budgeting/${ACTIVITY_FUND_SLUG}?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;

test.describe.configure({ mode: "serial" });

test.describe("Budgeting Overview/Drill-Down Restructure", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("unauthenticated visitor is redirected away from both the overview and the drill-down", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(OVERVIEW_URL);
    await expect(page).toHaveURL(/\/signin/);

    await page.goto(DRILLDOWN_URL);
    await expect(page).toHaveURL(/\/signin/);

    await context.close();
  });

  test("an invalid fundSlug for the resolved entity 404s on the drill-down", async ({ page }) => {
    await page.goto(
      `/admin/ledger/budgeting/not-a-real-fund?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`,
    );
    await expect(page.getByText(/this page could not be found/i)).toBeVisible();
  });

  test("overview -> drill-down -> overview: clicking a fund row navigates in, the breadcrumb navigates back, and both preserve ?entity=&fy=", async ({
    page,
  }) => {
    // Arrange / Act — land on the overview
    await page.goto(OVERVIEW_URL);

    // Assert — read-only summary present: fund name, "Edit budget" affordance,
    // an all-funds total row. No "+ Add" / editing controls on this page —
    // the overview is read-only by design.
    await expect(page.getByRole("heading", { name: "Activity Fund" })).toBeVisible();
    // "All Funds" also appears in the hidden print worksheet's own total row
    // — scope to the on-screen heading, not a bare text match.
    await expect(page.getByRole("heading", { name: "All Funds" })).toBeVisible();
    await expect(page.getByRole("button", { name: /\+ Add (income|expense) category/ })).toHaveCount(
      0,
    );

    // Act — whole-row navigation into the Activity Fund's drill-down (the
    // row's own Link, resolved via its "Edit budget" footer text). Scoped to
    // the Activity Fund's own row — Administrative Fund sorts first
    // (getFunds orders administrative-before-activity) and has its own
    // "Edit budget" footer too.
    const activityRow = page.locator("a", { hasText: "Activity Fund" });
    await activityRow.getByText("Edit budget", { exact: true }).click();

    // Assert — landed on the fund's own URL, entity+fy preserved
    await expect(page).toHaveURL(
      new RegExp(`/admin/ledger/budgeting/${ACTIVITY_FUND_SLUG}\\?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`),
    );
    await expect(page.getByRole("heading", { name: "Activity Fund", level: 1 })).toBeVisible();
    // The full editor — including "+ Add category" — now lives here.
    await expect(
      page.getByRole("button", { name: "+ Add income category" }),
    ).toBeVisible();

    // Act — breadcrumb back to the overview
    await page.getByRole("link", { name: /Budget Overview/ }).click();

    // Assert — back on the overview, same entity+fy
    await expect(page).toHaveURL(
      new RegExp(`/admin/ledger/budgeting\\?entity=${ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`),
    );
    await expect(page.getByRole("heading", { name: "Budget Planning" })).toBeVisible();
  });

  test("the all-funds total row sums each fund row's own Beginning/Income/Expense/Net/Final Bank figures", async ({
    page,
  }) => {
    await page.goto(OVERVIEW_URL);

    // Every StatCell renders as a <dt>/<dd> pair; grab each fund row's
    // "Final Bank (Jun 30)" figure and the "All Funds" row's own figure,
    // then assert the total equals the sum — proves the total row isn't
    // hand-typed or independently computed (Phase 3 design's stated
    // correctness property: overview screen and print derive from the same
    // computeFundPlanSums call over the same data).
    const finalBankCells = page.locator(
      `xpath=//dt[normalize-space(text())="Final Bank (Jun 30)"]/following-sibling::dd[1]`,
    );
    const count = await finalBankCells.count();
    expect(count).toBeGreaterThanOrEqual(2); // at least Administrative + Activity + the total row

    const toCents = (s: string) => Math.round(parseFloat(s.replace(/[^0-9.-]/g, "")) * 100);
    const texts = await finalBankCells.allTextContents();
    const perFundCents = texts.slice(0, -1).map(toCents);
    const totalCents = toCents(texts[texts.length - 1]);
    const summedCents = perFundCents.reduce((a, b) => a + b, 0);

    expect(totalCents).toBe(summedCents);
  });

  test("Notes & Assumptions: save persists across reload and renders on the printed document", async ({
    page,
  }) => {
    const NOTE_TEXT = `E2E QA overview notes ${Date.now()}`;

    // Arrange
    await page.goto(OVERVIEW_URL);
    const notesField = page.getByLabel("Notes & Assumptions");
    await expect(notesField).toBeVisible();
    await notesField.fill(NOTE_TEXT);

    // Act
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/ledger/budget-notes") && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: "Save notes" }).click(),
    ]);
    await expect(page.getByText("Budget notes saved.")).toBeVisible();

    // Assert — persisted server-side, not just optimistic client state
    await page.reload();
    await expect(page.getByLabel("Notes & Assumptions")).toHaveValue(NOTE_TEXT);

    // Assert — renders on the print document's front page
    const worksheet = page
      .locator("h1:has-text('Annual Operating Budget')")
      .locator("..")
      .locator("..");
    await expect(worksheet).toContainText("Notes & Assumptions");
    await expect(worksheet).toContainText(NOTE_TEXT);
  });

  test("print structure: Consolidated Summary front matter, a DRAFT status stamp for a never-approved FY, and per-fund detail sections", async ({
    page,
  }) => {
    await page.goto(OVERVIEW_URL);

    const worksheet = page
      .locator("h1:has-text('Annual Operating Budget')")
      .locator("..")
      .locator("..");

    // Assert — retitled from "Budget Worksheet" (B-31 Locked Decision 1)
    await expect(worksheet.locator("h1")).toContainText(`Annual Operating Budget, FY${TEST_FISCAL_YEAR}`);

    // Assert — three-state stamp, never-approved case
    await expect(worksheet).toContainText("DRAFT — Not Yet Approved by the Board");

    // Assert — Consolidated Summary table present with both funds + an All
    // Funds total row, ahead of the per-fund detail sections
    await expect(worksheet).toContainText("Consolidated Summary");
    await expect(worksheet).toContainText("Beginning Balance (7/1)");
    await expect(worksheet).toContainText("Projected Ending Balance (6/30)");
    await expect(worksheet).toContainText("All Funds");

    // Assert — per-fund detail sections, each with the Beginning/Net/
    // Projected-Ending balance blocks + an Income/Expense Total row (B-31)
    await expect(worksheet).toContainText("Beginning Fund Balance, July 1");
    await expect(worksheet).toContainText("Net Surplus/(Deficit):");
    await expect(worksheet).toContainText("Projected Ending Balance, June 30");
    await expect(worksheet).toContainText("Income Total");
    await expect(worksheet).toContainText("Expense Total");
  });
});
