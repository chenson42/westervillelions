/**
 * e2e tests for cancel/restore occurrence (v1.13.0) and signup-blocked (gap #1, gap #5).
 *
 * Self-seeding fixture (2026-09-09 remediation, docs/reviews/2026-09-09-test-coverage.md):
 * this suite used to point at a real seeded event ("Farmer's Market Signup",
 * id 291c76f3-ab75-4c64-8173-ac285345cfe9) with hardcoded occurrence dates
 * (2026-08-01 / 2026-08-08). Those dates rotted once (advanced from an
 * earlier past date in June) and rotted again by 2026-09-09 — the route's
 * past-occurrence guard fires before the cancelled-occurrence guard these
 * tests exist to verify, so a stale date silently breaks the SIGNUP_BLOCKED
 * test's whole premise. Worse, that event's own `recurrence_end_date` is
 * 2026-09-26, so even "compute the next future Saturday" would have stopped
 * working within weeks.
 *
 * This suite now creates its own private, RSVP-enabled, weekly-recurring
 * event in `beforeAll` with a rolling window computed from the real
 * wall-clock "now" at run time (start 7 days out, recurring for 90 days —
 * comfortably covers the two occurrences these tests need, 14 and 21 days
 * out), and deletes it in `afterAll` (pass or fail — Playwright always runs
 * a registered `afterAll`). `events` -> `event_occurrence_overrides` and
 * `events` -> `event_rsvps` are both `ON DELETE CASCADE` (schema.ts), so
 * deleting the event via `DELETE /api/admin/events/[id]` is sufficient
 * cleanup — no separate override/RSVP delete needed.
 *
 * Test user: lions-e2e-test@westervillelions.org (admin role, created by scripts/create-test-user.mjs)
 *
 * Coverage closed:
 *   Gap #1 — admin cancels/restores an occurrence + Cancelled badge on event detail
 *   Gap #5 — signup blocked when occurrence is cancelled (returns 400) — specifically that
 *            the CANCELLED guard fires (not the past-occurrence guard), which is exactly
 *            what rotted with the old hardcoded dates.
 */

import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";
import { addDays, format } from "date-fns";

// Populated by beforeAll below — real fixture ids/dates, never hardcoded.
let EVENT_ID = "";
let CANCEL_DATE = "";
let SIGNUP_BLOCKED_DATE = "";
let SIGNUP_BLOCKED_ISO = "";

const cancelUrl = (date: string) =>
  `/api/admin/events/${EVENT_ID}/occurrences/${date}/cancel`;
const signupUrl = () => `/api/events/${EVENT_ID}/signup`;
const eventDetailUrl = () => `/events/${EVENT_ID}`;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signInAsAdmin(page);

  // First occurrence a week out — comfortably clear of "now" under any
  // reasonable clock/timezone skew between the test runner and the app's
  // Eastern-wall-clock guard (nowEastern(), src/lib/events.ts).
  const start = addDays(new Date(), 7);
  const dayOfWeek = start.getDay();
  const startDate = `${format(start, "yyyy-MM-dd")}T12:30`;
  // 90-day window — far past the 21-day-out occurrence these tests use,
  // and far short of MAX_OCCURRENCES (200) at a weekly cadence.
  const recurrenceEndDate = `${format(addDays(start, 90), "yyyy-MM-dd")}T00:00`;

  const createResp = await page.request.post("/api/admin/events", {
    data: {
      title: `E2E QA Cancel Occurrence Fixture ${Date.now()}`,
      startDate,
      isPublic: false, // private — doesn't pollute the public /events list
      requiresRsvp: true,
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [dayOfWeek],
      recurrenceEndDate,
    },
  });
  expect(createResp.ok(), `fixture event creation failed: ${createResp.status()} ${await createResp.text()}`).toBe(true);
  const created = await createResp.json();
  EVENT_ID = created.id;

  // Two future occurrences of the weekly series — 14 and 21 days out.
  CANCEL_DATE = format(addDays(start, 14), "yyyy-MM-dd");
  SIGNUP_BLOCKED_DATE = format(addDays(start, 21), "yyyy-MM-dd");
  SIGNUP_BLOCKED_ISO = `${SIGNUP_BLOCKED_DATE}T12:30:00`;

  await page.close();
});

test.afterAll(async ({ browser }) => {
  // Pass or fail, always clean up — cascades to event_occurrence_overrides
  // and event_rsvps (both ON DELETE CASCADE, schema.ts).
  if (!EVENT_ID) return;
  const page = await browser.newPage();
  await signInAsAdmin(page);
  await page.request.delete(`/api/admin/events/${EVENT_ID}`);
  await page.close();
});

// serial: these tests share a DB row (CANCEL_DATE) so they must not run in parallel.
test.describe.serial("cancel-occurrence — admin cancel and restore", () => {
  // Clean up CANCEL_DATE occurrence before each test so tests start from a known state.
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    // Restore (no-op if no override row exists)
    await page.request.post(cancelUrl(CANCEL_DATE), { data: { cancelled: false } });
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
    await page.goto(eventDetailUrl());
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
    await page.goto(eventDetailUrl());
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

  test("POST /api/events/[id]/signup returns 400 when the occurrence is cancelled — regression for cancelled-occurrence signup guard — gap #5", async ({
    page,
  }) => {
    // Arrange — SIGNUP_BLOCKED_DATE is already cancelled (from beforeEach), and is a
    // genuinely FUTURE occurrence (21 days out) — the point of this fixture being
    // self-seeded and rolling is that this can never again rot into the past and
    // accidentally exercise the past-occurrence guard instead of the cancelled guard.

    // Act — attempt signup for the cancelled occurrence
    const signupResp = await page.request.post(signupUrl(), {
      data: { occurrenceDate: SIGNUP_BLOCKED_ISO },
    });

    // Assert — blocked with 400 and a "cancelled" error message specifically (not
    // "past occurrence" — that would mean the wrong guard fired).
    expect(signupResp.status()).toBe(400);
    const body = await signupResp.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/cancelled/i);
    expect(body.error).not.toMatch(/past/i);
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
