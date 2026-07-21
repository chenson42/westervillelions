import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Failed Login Visibility — /admin/security.
 *
 * Covers the Phase 5 verification flows from
 * docs/work-log/2026-07-21-failed-login-visibility.md: the admin gate, the
 * list view + search + empty state, the grouped view, and the stored-XSS
 * spot-check on the attempted-email column (regression coverage for the
 * analyst's stored-XSS-via-audit-log hard requirement).
 *
 * Each test triggers a REAL failed sign-in attempt through the actual
 * NextAuth credentials callback (same code path the recorder hooks into —
 * src/lib/auth/index.ts) using a unique, timestamped marker email, then
 * polls the admin page until the fire-and-forget recorder's row lands. This
 * keeps tests independent of each other and of any state QA's manual
 * verification pass may have left behind — no test depends on another
 * test's row, and no test reaches into the DB directly (matching this
 * suite's existing black-box-against-the-running-app discipline).
 *
 * There is no delete/manage action for this table in v1 (passive viewing
 * only, per the locked "alerting not selected" decision) — rows created here
 * are left for the recorder's own 90-day opportunistic prune, exactly as a
 * real failed attempt would be. This is intentional, not a cleanup gap.
 */

async function triggerFailedCredentialsAttempt(page: Page, email: string): Promise<void> {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  const { csrfToken } = await csrfResponse.json();

  await page.request.post("/api/auth/callback/credentials", {
    form: {
      email,
      password: "definitely-wrong-e2e-probe-password",
      csrfToken,
      json: "true",
    },
  });
}

function uniqueMarkerEmail(tag: string): string {
  return `e2e-security-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

// Serial, not parallel: this suite already runs several specs
// (cancel-occurrence.spec.ts, recurring-signup-rollup.spec.ts) that share a
// single fixture event (id 291c76f3-ab75-4c64-8173-ac285345cfe9) and are
// timing-sensitive under high worker parallelism against one dev server.
// This file doesn't touch that event at all, but running its 5 independent
// tests serially instead of in 5 parallel workers keeps total concurrent
// load down and avoids tipping that pre-existing fragility into a flake —
// see docs/work-log/2026-07-21-failed-login-visibility.md Phase 5 notes.
test.describe.configure({ mode: "serial" });

test.describe("admin security page", () => {
  test("unauthenticated visitor is redirected away from /admin/security", async ({ page }) => {
    // Arrange / Act
    await page.goto("/admin/security");

    // Assert
    await expect(page).toHaveURL(/\/signin/);
  });

  test("an authenticated admin can view the failed-login list and grouped views", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    const marker = uniqueMarkerEmail("views");
    await triggerFailedCredentialsAttempt(page, marker);

    // Act
    await expect(async () => {
      await page.goto(`/admin/security?email=${encodeURIComponent(marker)}`);
      await expect(page.locator("tbody")).toContainText(marker);
    }).toPass({ timeout: 10_000 });

    // Assert — list view
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Attempt Log" })).toBeVisible();
    await expect(page.getByRole("link", { name: "By Email" })).toBeVisible();

    // Act — switch to grouped view (independent of the list's email filter)
    await page.getByRole("link", { name: "By Email" }).click();

    // Assert — grouped view renders and includes the marker row
    await expect(page).toHaveURL(/view=grouped/);
    await expect(page.locator("th", { hasText: "Failures" })).toBeVisible();
    await expect(page.locator("tbody")).toContainText(marker);
  });

  test("search filters the list view down to matching attempted emails only", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    const marker = uniqueMarkerEmail("search");
    await triggerFailedCredentialsAttempt(page, marker);

    // Act
    await expect(async () => {
      await page.goto("/admin/security");
      await page.getByLabel("Search by attempted email").fill(marker);
      await page.getByRole("button", { name: "Search" }).click();
      await expect(page.locator("tbody tr")).toHaveCount(1);
    }).toPass({ timeout: 10_000 });

    // Assert
    await expect(page).toHaveURL(new RegExp(`email=${encodeURIComponent(marker)}`));
    await expect(page.locator("tbody")).toContainText(marker);
  });

  test("shows the empty-state sentence when a search matches no attempts", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/security");

    // Act — search for an address guaranteed never to have attempted a login
    await page
      .getByLabel("Search by attempted email")
      .fill(uniqueMarkerEmail("never-attempted"));
    await page.getByRole("button", { name: "Search" }).click();

    // Assert
    await expect(page.getByText(/No failed login attempts found for/)).toBeVisible();
  });

  test("renders a stored script-tag attempted-email as literal text, not executable markup — regression for stored-XSS-via-audit-log", async ({ page }) => {
    // Arrange — the marker itself contains a literal <script> tag; the
    // recorder does not sanitize storage, so this attempt lands verbatim in
    // failed_login_attempts.attempted_email (see failed-login.test.ts test #4).
    await signInAsAdmin(page);
    const marker = `<script>window.__xssMarkerFired = true</script>@${uniqueMarkerEmail("xss")}`;
    await triggerFailedCredentialsAttempt(page, marker);

    let dialogFired = false;
    page.once("dialog", () => {
      dialogFired = true;
    });

    // Act
    await expect(async () => {
      await page.goto(`/admin/security?email=${encodeURIComponent(marker)}`);
      await expect(page.locator("tbody")).toContainText(marker);
    }).toPass({ timeout: 10_000 });

    // Assert — the tag appears as literal text content, and never executed
    // (no dialog fired, no global flag set — the page renders it via plain
    // JSX interpolation, never dangerouslySetInnerHTML).
    const scriptRan = await page.evaluate(
      () => (window as unknown as { __xssMarkerFired?: boolean }).__xssMarkerFired
    );
    expect(scriptRan).toBeUndefined();
    expect(dialogFired).toBe(false);
  });
});
