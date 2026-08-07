import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Membership Type on the member record — docs/work-log/2026-08-07-membership-categories.md.
 *
 * Covers the Phase 5 flows the runner CAN reach against a real browser + real
 * running app: the labeling-discipline requirement (Membership Type reads
 * distinctly from Membership Status, no bare "Category"/"Active" heading
 * collision), and — the single highest-risk claim in this feature — that
 * editing a member WITHOUT touching membershipType (e.g. only changing the
 * phone number) still saves successfully, because PATCH /api/admin/members/[id]
 * hard-400s when membershipType is omitted from the request body and the
 * form is the only production caller of that route. If the form ever regresses
 * to submitting a partial body, this test fails loudly instead of silently
 * breaking every member edit in production.
 */

test.describe("membership type on the member edit form", () => {
  test("editing only the phone number succeeds and leaves membership type unchanged — regression for PATCH hard-400-on-omitted-membershipType breaking ordinary edits", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/members");
    await page.waitForSelector("h1:has-text('Members')");
    const firstEditLink = page.getByRole("link", { name: "Edit" }).first();
    await firstEditLink.waitFor();
    await firstEditLink.click();
    await page.waitForURL(/\/admin\/members\/[^/]+$/);

    const typeSelect = page.locator("#membershipType");
    await typeSelect.waitFor();
    const originalType = await typeSelect.inputValue();

    const phoneInput = page.locator("#phone");
    await phoneInput.waitFor();
    const originalPhone = await phoneInput.inputValue();
    const probePhone = "614-555-0199";

    // Act — change ONLY the phone field, leave membership type untouched
    await phoneInput.fill(probePhone);
    await page.getByRole("button", { name: /Save|Update/ }).click();

    // Assert — save succeeds (no error toast), not a 400
    await expect(page.getByText(/Member updated successfully/)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/An error occurred/)).not.toBeVisible();

    // Assert — reload and confirm the phone change persisted and membership
    // type is exactly what it was before, never reset by the untouched save
    await page.reload();
    await page.waitForSelector("#membershipType");
    await expect(page.locator("#phone")).toHaveValue(probePhone);
    await expect(page.locator("#membershipType")).toHaveValue(originalType);

    // Cleanup — restore the original phone value so this test doesn't leave
    // dev-DB drift behind on every run
    await page.locator("#phone").fill(originalPhone);
    await page.getByRole("button", { name: /Save|Update/ }).click();
    await expect(page.getByText(/Member updated successfully/)).toBeVisible({
      timeout: 10000,
    });
  });

  test("Membership Type reads as distinct from Membership Status — labeling-discipline requirement", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/members");
    await page.waitForSelector("h1:has-text('Members')");
    const firstEditLink = page.getByRole("link", { name: "Edit" }).first();
    await firstEditLink.waitFor();
    await firstEditLink.click();
    await page.waitForURL(/\/admin\/members\/[^/]+$/);

    // Assert — both fields are labeled explicitly and neither reads as bare
    // "Category" or bare "Active" — the entire reason this design exists is
    // that both fields can independently hold the value "active"
    await expect(page.getByText("Membership Status *")).toBeVisible();
    await expect(page.getByText("Lions International Membership Type *")).toBeVisible();
    await expect(
      page.getByText(/separate from Membership Status above/)
    ).toBeVisible();

    // Assert — the type select offers all 7 LCI taxonomy values
    const options = await page.locator("#membershipType option").allTextContents();
    expect(options).toEqual([
      "Active",
      "Member at Large",
      "Honorary",
      "Privileged",
      "Life Member",
      "Associate Member",
      "Affiliate Member",
    ]);
  });

  test("creating a member without touching membership type defaults it to Active", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/members/new");

    // Assert — the type select is pre-selected to Active without any interaction
    const typeSelect = page.locator("#membershipType");
    await typeSelect.waitFor();
    await expect(typeSelect).toHaveValue("active");
  });
});

/**
 * LCI Type on the admin members LIST — Phase 6 follow-up #1
 * (docs/decisions.md DECISION-064 item 4; work-log Phase 6 "Follow-Ups" #1).
 *
 * Before this, the only way to see a member's membership type was to open
 * their edit page one at a time — impractical for the treasurer's ~50-member
 * correction pass. Covers: the list shows a distinct, labeled "LCI Type"
 * column (never a bare "Active" that could be confused with the adjacent
 * Status pill), the display label renders (not the raw snake_case DB token),
 * and the new type filter narrows the list and round-trips through the URL.
 */
test.describe("LCI Type column and filter on the admin members list", () => {
  test("list shows a distinct LCI Type column next to Status, rendering the display label not the raw token", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/members");
    await page.waitForSelector("h1:has-text('Members')");

    // Assert — both column headers are present and distinctly labeled; "LCI
    // Type" never collapses to a bare "Type" or "Category" that could read
    // as a duplicate of "Status"
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "LCI Type" })).toBeVisible();

    // Assert — at least one data row renders a real MEMBERSHIP_TYPES display
    // label (e.g. "Active", "Life Member"), never a raw snake_case token
    // like "life_member" or "member_at_large" leaking into the UI
    const firstRow = page.locator("tbody tr").first();
    await firstRow.waitFor();
    const rowText = (await firstRow.textContent()) || "";
    expect(rowText).toMatch(
      /Active|Member at Large|Honorary|Privileged|Life Member|Associate Member|Affiliate Member/
    );
    expect(rowText).not.toMatch(/member_at_large|life_member|associate_member|affiliate_member/);
  });

  test("LCI Type filter narrows the list and round-trips through the URL", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/members");
    await page.waitForSelector("h1:has-text('Members')");

    // Act — filter to "Active" (the backfilled default, so this always
    // matches at least the un-corrected members without depending on any
    // specific treasurer correction existing in this environment)
    const typeFilter = page.locator("#membershipTypeFilter");
    await typeFilter.waitFor();
    await typeFilter.selectOption("active");
    await page.waitForURL(/[?&]type=active/);

    // Assert — results still present, and every visible row's LCI Type cell
    // reads "Active"
    await expect(page.getByText(/^Showing \d+/)).toBeVisible();
    const typeCells = page.locator("tbody tr td:nth-child(6)");
    const count = await typeCells.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(typeCells.nth(i)).toHaveText("Active");
    }

    // Act — clear filters
    await page.getByRole("button", { name: "Clear" }).click();
    await page.waitForURL("**/admin/members");

    // Assert — the type param is gone
    expect(page.url()).not.toContain("type=");
  });
});
