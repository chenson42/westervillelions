/**
 * e2e auth helper — signs in via the credentials form and stores session cookies
 * in the provided browser context so subsequent requests are authenticated.
 *
 * Usage:
 *   const page = await browser.newPage();
 *   await signInAsAdmin(page);
 *   // page is now authenticated
 */
import type { Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

/**
 * Signs in as the e2e test admin user via the credentials sign-in form.
 * After this call, `page` holds a session cookie that is valid for all
 * protected routes the admin can access.
 */
export async function signInAsAdmin(page: Page): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      "E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set in .env.local"
    );
  }

  await page.goto("/signin");

  // Fill in the email/password form (below the Google button)
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for navigation away from /signin — successful auth redirects to /members
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), {
    timeout: 15000,
  });
}
