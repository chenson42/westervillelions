import { test, expect } from "@playwright/test";

test.describe("public smoke", () => {
  test("homepage renders", async ({ page }) => {
    await page.goto("/");

    // Lions Club site references — at least one should land
    await expect(page.locator("body")).toContainText(/Westerville Lions/i);
  });

  test("events page renders", async ({ page }) => {
    await page.goto("/events");

    await expect(page).toHaveURL(/\/events/);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("members route redirects unauthenticated visitors to signin", async ({ page }) => {
    await page.goto("/members");

    // Either landed at /signin or got the access-pending page — both are acceptable
    // sign-out outcomes. The wrong outcome would be the actual member directory loading.
    await expect(page).toHaveURL(/\/(signin|access-pending)/);
  });
});
