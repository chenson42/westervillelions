/**
 * e2e tests for cancel/restore occurrence (v1.13.0) and signup-blocked (gap #1, gap #5).
 *
 * These tests use the Farmer's Market Signup event (id: 291c76f3-ab75-4c64-8173-ac285345cfe9),
 * which is a private recurring weekly event with RSVP enabled. All API calls go directly
 * to the route handlers — no admin UI navigation required.
 *
 * Test user: lions-e2e-test@westervillelions.org (admin role, created by scripts/create-test-user.mjs)
 *
 * Coverage closed:
 *   Gap #1 — admin cancels/restores an occurrence + Cancelled badge on event detail
 *   Gap #5 — signup blocked when occurrence is cancelled (returns 400)
 */

import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

// Stable recurring event in the DB that has requiresRsvp: true.
// Private event so it doesn't pollute /events. Has future occurrences (series runs to Sep 2026).
const EVENT_ID = "291c76f3-ab75-4c64-8173-ac285345cfe9";

// Different occurrence dates per test group to prevent parallel-test interference.
// Saturday 2026-05-30 — cancel/restore tests (series recurrenceDays:[6], starts May 16)
// Saturday 2026-06-06 — signup-blocked tests
const CANCEL_DATE = "2026-05-30";
const SIGNUP_BLOCKED_DATE = "2026-06-06";
// ISO timestamp matching SIGNUP_BLOCKED_DATE at the event's wall-clock start time (12:30 PM)
// Used when POST-ing to /api/events/[id]/signup; the route converts via dateKey() → "2026-06-06"
const SIGNUP_BLOCKED_ISO = "2026-06-06T12:30:00";

const cancelUrl = (date: string) =>
  `/api/admin/events/${EVENT_ID}/occurrences/${date}/cancel`;
const SIGNUP_URL = `/api/events/${EVENT_ID}/signup`;
const EVENT_DETAIL_URL = `/events/${EVENT_ID}`;

// serial: these tests share a DB row (CANCEL_DATE) so they must not run in parallel.
test.describe.serial("cancel-occurrence — admin cancel and restore", () => {
  // Clean up CANCEL_DATE occurrence before each test so tests start from a known state.
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    // Restore (no-op if no override row exists)
    await page.request.post(cancelUrl(CANCEL_DATE), { data: { cancelled: false } });
  });

  // Clean up after all tests in this group so the DB is tidy.
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await signInAsAdmin(p);
    await p.request.post(cancelUrl(CANCEL_DATE), { data: { cancelled: false } });
    await ctx.close();
  });

  test("admin can cancel an occurrence with a reason — badge and reason appear on event detail — gap #1", async ({
    page,
  }) => {
    // Arrange — already signed in and occurrence is restored (from beforeEach)
    const reason = "Venue unavailable for this date";

    // Act — cancel the occurrence via the API
    const cancelResp = await page.request.post(cancelUrl(CANCEL_DATE), {
      data: { cancelled: true, reason },
    });

    // Assert — cancel API returns 200 with the override row
    expect(cancelResp.status()).toBe(200);
    const body = await cancelResp.json();
    expect(body).toHaveProperty("eventId", EVENT_ID);
    expect(body).toHaveProperty("occurrenceDate", CANCEL_DATE);
    expect(body).toHaveProperty("cancellationReason", reason);
    expect(body).toHaveProperty("cancelledAt");

    // Assert — event detail page shows the "Cancelled" badge for this occurrence
    await page.goto(EVENT_DETAIL_URL);
    // The OccurrenceSignupList renders a "Cancelled" span for cancelled rows
    await expect(page.locator("text=Cancelled").first()).toBeVisible({ timeout: 10000 });
    // The cancellation reason should also appear
    await expect(page.locator("body")).toContainText(reason, { timeout: 10000 });
  });

  test("admin can restore a cancelled occurrence — Cancelled badge disappears — gap #1", async ({
    page,
  }) => {
    // Arrange — cancel first so we have something to restore
    const cancelResult = await page.request.post(cancelUrl(CANCEL_DATE), {
      data: { cancelled: true, reason: "Test cancel — restore test" },
    });
    expect(cancelResult.status()).toBe(200);

    // Confirm it's cancelled on the detail page
    await page.goto(EVENT_DETAIL_URL);
    await expect(page.locator("body")).toContainText("Test cancel — restore test", {
      timeout: 10000,
    });

    // Act — restore the occurrence
    const restoreResp = await page.request.post(cancelUrl(CANCEL_DATE), {
      data: { cancelled: false },
    });

    // Assert — restore API returns { restored: true }
    expect(restoreResp.status()).toBe(200);
    const restoreBody = await restoreResp.json();
    expect(restoreBody).toHaveProperty("restored", true);

    // Assert — event detail page no longer shows the cancellation reason
    await page.reload();
    await expect(page.locator("body")).not.toContainText("Test cancel — restore test");
  });
});

// serial: these tests share SIGNUP_BLOCKED_DATE
test.describe.serial("cancel-occurrence — signup blocked on cancelled occurrence", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    // Ensure SIGNUP_BLOCKED_DATE is cancelled
    await page.request.post(cancelUrl(SIGNUP_BLOCKED_DATE), {
      data: { cancelled: true, reason: "Blocked for e2e test" },
    });
  });

  test.afterAll(async ({ browser }) => {
    // Clean up: restore so other test runs start clean
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await signInAsAdmin(p);
    await p.request.post(cancelUrl(SIGNUP_BLOCKED_DATE), { data: { cancelled: false } });
    await ctx.close();
  });

  test("POST /api/events/[id]/signup returns 400 when the occurrence is cancelled — regression for cancelled-occurrence signup guard — gap #5", async ({
    page,
  }) => {
    // Arrange — SIGNUP_BLOCKED_DATE is already cancelled (from beforeEach)

    // Act — attempt signup for the cancelled occurrence
    const signupResp = await page.request.post(SIGNUP_URL, {
      data: { occurrenceDate: SIGNUP_BLOCKED_ISO },
    });

    // Assert — blocked with 400 and a "cancelled" error message
    expect(signupResp.status()).toBe(400);
    const body = await signupResp.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/cancelled/i);
  });
});

test.describe("cancel-occurrence — permission gate", () => {
  test("POST to cancel endpoint without auth returns 401 — gap #1 permission coverage", async ({
    page,
  }) => {
    // Arrange — no sign-in (unauthenticated page)

    // Act — call the cancel endpoint without a session
    const resp = await page.request.post(cancelUrl(CANCEL_DATE), {
      data: { cancelled: true },
    });

    // Assert — 401 Unauthorized (auth check fires before feature check)
    expect(resp.status()).toBe(401);
  });
});
