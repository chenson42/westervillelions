/**
 * e2e regression tests for recurring event signup rollup (v1.16.1 fix).
 *
 * Before this fix the admin events list scoped each recurring event's signup count
 * to the next upcoming occurrence only. The detail page had no series-level summary
 * at all. Both are now fixed:
 *   - List page: sum RSVPs across all non-cancelled occurrences
 *   - Detail page: rollup header above the per-occurrence breakdown
 *
 * Target event: "Farmer's Market Signup" (id: 291c76f3-ab75-4c64-8173-ac285345cfe9)
 *   Private recurring weekly (Saturdays) event with requiresRsvp: true.
 *   Series runs through Sep 2026.
 *
 * Non-recurring target: "Lions Club Meeting" (id: 2a68b4c6-2068-4d5d-84d6-223167260c7b)
 *   Public non-recurring event used to verify the non-recurring path is unchanged.
 *
 * Dates used (Saturdays, 12:30 PM wall-clock — distinct from cancel-occurrence tests):
 *   ROLLUP_DATE_A      = 2026-06-13  (first occurrence: receives one test RSVP)
 *   ROLLUP_DATE_B      = 2026-06-20  (second occurrence: receives one test RSVP in Test 1)
 *   ROLLUP_CANCEL_DATE = 2026-06-27  (occurrence cancelled in Test 2 — RSVP on it is excluded)
 *
 * Assertions are relative to a baseline captured before adding any test RSVPs so that
 * pre-existing RSVPs from real member data do not cause false failures.
 *
 * All API calls go directly to route handlers to keep tests focused and fast.
 *
 * Coverage closed:
 *   rollup-bug — admin list shows sum across all non-cancelled occurrences
 *   rollup-bug — detail page rollup header renders correct text
 *   rollup-bug — cancelled occurrences excluded from rollup
 *   rollup-bug — non-recurring path unchanged
 */

import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

const EVENT_ID = "291c76f3-ab75-4c64-8173-ac285345cfe9";
const NON_RECURRING_EVENT_ID = "2a68b4c6-2068-4d5d-84d6-223167260c7b";

// Saturdays in the Farmer's Market series, wall-clock time 12:30 PM
// These dates must not overlap with cancel-occurrence.spec.ts dates (05-30, 06-06).
const ROLLUP_DATE_A = "2026-06-13";
const ROLLUP_DATE_B = "2026-06-20";
const ROLLUP_CANCEL_DATE = "2026-06-27";

// ISO timestamps at the event's wall-clock start time (12:30 PM)
const ROLLUP_ISO_A = `${ROLLUP_DATE_A}T12:30:00`;
const ROLLUP_ISO_B = `${ROLLUP_DATE_B}T12:30:00`;
const ROLLUP_ISO_CANCEL = `${ROLLUP_CANCEL_DATE}T12:30:00`;

const signupUrl = `/api/admin/events/${EVENT_ID}/signup`;
const cancelUrl = (date: string) =>
  `/api/admin/events/${EVENT_ID}/occurrences/${date}/cancel`;
const ADMIN_LIST_URL = "/admin/events";
const ADMIN_DETAIL_URL = `/admin/events/${EVENT_ID}`;
const NON_RECURRING_DETAIL_URL = `/admin/events/${NON_RECURRING_EVENT_ID}`;

// Fetch the current user's ID from the NextAuth session endpoint.
async function getCurrentUserId(page: import("@playwright/test").Page): Promise<string> {
  const resp = await page.request.get("/api/auth/session");
  expect(resp.status()).toBe(200);
  const data = await resp.json();
  const userId = data?.user?.id as string | undefined;
  if (!userId) throw new Error("Could not determine current user ID from session");
  return userId;
}

/**
 * Read the rollup header from the detail page and return the attending count and
 * occurrence count.  The header text looks like:
 *   "32 attending across 17 occurrences"
 */
async function readDetailRollup(
  page: import("@playwright/test").Page
): Promise<{ attending: number; occurrences: number }> {
  await page.goto(ADMIN_DETAIL_URL);
  await page.waitForLoadState("networkidle");

  const rollupBlock = page.locator("#attendance .bg-blue-50").first();
  await expect(rollupBlock).toBeVisible({ timeout: 10000 });

  const text = await rollupBlock.innerText();
  const match = text.match(/(\d+)\s+attending across\s+(\d+)/);
  if (!match) {
    throw new Error(
      `Could not parse rollup baseline from header text: "${text}"`
    );
  }
  return {
    attending: parseInt(match[1], 10),
    occurrences: parseInt(match[2], 10),
  };
}

/**
 * Read the Farmer's Market attending count from the admin events list page.
 * The EventTableRow renders an expanded sub-row (bg-blue-50) with text like
 * "✓ 33 attending~ 0 maybe". We read the tbody and parse the first "N attending"
 * occurrence. Both the header row and RSVP summary row are children of <tbody>.
 *
 * NOTE: This reads from the list page that is already loaded. Caller must navigate
 * to ADMIN_LIST_URL and wait for networkidle before calling this function.
 */
async function readListAttending(
  page: import("@playwright/test").Page
): Promise<number> {
  const text = await page.locator("tbody").innerText();
  // The expanded sub-row text starts with "✓ N attending"
  const match = text.match(/✓\s*(\d+)\s+attending/);
  if (!match) {
    throw new Error(
      `Could not find "✓ N attending" in list tbody text. tbody: "${text.slice(0, 200)}"`
    );
  }
  return parseInt(match[1], 10);
}

// serial: tests share occurrence dates and the DB; must not run in parallel.
test.describe.serial("recurring-signup-rollup — list and detail page", () => {
  let userId: string;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await signInAsAdmin(p);
    userId = await getCurrentUserId(p);
    await ctx.close();
  });

  // Clean up all test RSVPs and overrides before each test so tests start from a known state.
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);

    // Remove any RSVPs for the three test dates
    for (const iso of [ROLLUP_ISO_A, ROLLUP_ISO_B, ROLLUP_ISO_CANCEL]) {
      await page.request.delete(signupUrl, { data: { userId, occurrenceDate: iso } });
    }
    // Restore any cancelled dates
    for (const date of [ROLLUP_DATE_A, ROLLUP_DATE_B, ROLLUP_CANCEL_DATE]) {
      await page.request.post(cancelUrl(date), { data: { cancelled: false } });
    }
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await signInAsAdmin(p);
    // Full cleanup: remove RSVPs and restore cancelled dates
    for (const iso of [ROLLUP_ISO_A, ROLLUP_ISO_B, ROLLUP_ISO_CANCEL]) {
      await p.request.delete(signupUrl, { data: { userId, occurrenceDate: iso } });
    }
    for (const date of [ROLLUP_DATE_A, ROLLUP_DATE_B, ROLLUP_CANCEL_DATE]) {
      await p.request.post(cancelUrl(date), { data: { cancelled: false } });
    }
    await ctx.close();
  });

  test("Test 1 — admin events list shows sum of RSVPs across two occurrences — rollup-bug regression", async ({
    page,
  }) => {
    // ── Phase 1: Capture list attending count before adding any RSVPs ──────
    // We read the list page first so we have a within-test baseline that is
    // insulated from the transient effects of cancel-occurrence.spec.ts running
    // concurrently (those tests only touch 2026-05-30 and 2026-06-06, which are
    // not our dates and do not affect the list attending count we read here).
    await page.goto(ADMIN_LIST_URL);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText("Farmer", { timeout: 10000 });
    const listBefore = await readListAttending(page);

    // ── Phase 2: Add RSVPs on two distinct occurrence dates ────────────────
    const respA = await page.request.post(signupUrl, {
      data: { userId, occurrenceDate: ROLLUP_ISO_A },
    });
    expect([200, 201]).toContain(respA.status());

    const respB = await page.request.post(signupUrl, {
      data: { userId, occurrenceDate: ROLLUP_ISO_B },
    });
    expect([200, 201]).toContain(respB.status());

    // ── Phase 3: Assert list page count increased by at least 2 ──────────────
    // The regression test: the old code counted only the NEXT upcoming occurrence;
    // after the fix, BOTH dates A and B are counted. We assert >= listBefore + 2
    // (rather than ===) because cancel-occurrence.spec.ts runs concurrently and may
    // transiently restore a cancelled occurrence between the two reads, adding 1 more
    // to the count. That is not a regression; the +2 minimum proves both dates counted.
    await page.goto(ADMIN_LIST_URL);
    await page.waitForLoadState("networkidle");
    const listAfter = await readListAttending(page);
    expect(listAfter).toBeGreaterThanOrEqual(listBefore + 2);

    // ── Phase 4: Assert detail page rollup header exists ───────────────────
    // Before the fix, recurring events had NO series-level rollup header at all.
    // After the fix, the blue panel with "X attending across Y occurrences" must appear.
    await page.goto(ADMIN_DETAIL_URL);
    await page.waitForLoadState("networkidle");
    const rollupBlock = page.locator("#attendance .bg-blue-50").first();
    await expect(rollupBlock).toBeVisible({ timeout: 10000 });
    await expect(rollupBlock).toContainText("attending across");
  });

  test("Test 2 — cancelled occurrence excluded from list count and detail rollup header — rollup-bug regression", async ({
    page,
  }) => {
    // ── Phase 1: Baseline before any changes ───────────────────────────────
    // beforeEach ensured the three test dates are not cancelled and the test
    // admin user has no RSVPs on them.
    const baseline = await readDetailRollup(page);
    // baseline.occurrences includes ROLLUP_CANCEL_DATE (it is non-cancelled at this point).

    // ── Arrange: add RSVPs on date A and CANCEL_DATE ───────────────────────
    await page.request.post(signupUrl, {
      data: { userId, occurrenceDate: ROLLUP_ISO_A },
    });
    await page.request.post(signupUrl, {
      data: { userId, occurrenceDate: ROLLUP_ISO_CANCEL },
    });

    // ── Phase 2: Read rollup BEFORE cancellation ───────────────────────────
    // Both RSVPs are now counted. There may be pre-existing RSVPs on either date
    // from real club members; we do not assume a specific value — we just record it.
    // NOTE: cancel-occurrence.spec.ts runs concurrently and may transiently cancel
    // 2026-05-30 or 2026-06-06, which can cause the occurrence count to differ from
    // baseline.occurrences by 1. We use a >= check to tolerate this.
    const beforeCancel = await readDetailRollup(page);
    // Sanity: at least the date A RSVP must have been counted. We use >= baseline + 1
    // rather than + 2 because cancel-occurrence.spec.ts may concurrently cancel a
    // different occurrence (2026-05-30 or 2026-06-06), temporarily reducing the count
    // by 1 between our baseline read and this read. The core regression assertion below
    // (afterCancel < beforeCancel) is what matters, not this sanity check.
    expect(beforeCancel.attending).toBeGreaterThanOrEqual(baseline.attending + 1);

    // ── Cancel CANCEL_DATE ─────────────────────────────────────────────────
    // This removes CANCEL_DATE from the non-cancelled occurrence set, and all
    // RSVPs on CANCEL_DATE (pre-existing + the test RSVP) must be excluded
    // from the rollup. Only date A's RSVP should remain from the two we added.
    const cancelResp = await page.request.post(cancelUrl(ROLLUP_CANCEL_DATE), {
      data: { cancelled: true, reason: "Rollup e2e test cancel" },
    });
    expect(cancelResp.status()).toBe(200);

    // ── Phase 3: Assert detail page rollup AFTER cancellation ──────────────
    await page.goto(ADMIN_DETAIL_URL);
    await page.waitForLoadState("networkidle");

    const rollupBlock = page.locator("#attendance .bg-blue-50").first();
    await expect(rollupBlock).toBeVisible({ timeout: 10000 });

    const text = await rollupBlock.innerText();
    const match = text.match(/(\d+)\s+attending across\s+(\d+)/);
    expect(match, `Rollup header not found in: "${text}"`).not.toBeNull();
    const afterCancel = {
      attending: parseInt(match![1], 10),
      occurrences: parseInt(match![2], 10),
    };

    // Core regression invariant: cancelling an occurrence must DECREASE the
    // attending count. In the pre-fix code both counts were equal.
    expect(afterCancel.attending).toBeLessThan(beforeCancel.attending);

    // The test RSVP on CANCEL_DATE plus any pre-existing RSVPs on CANCEL_DATE are
    // all excluded. Only the date A RSVP remains from what we added.
    // beforeCancel.attending = baseline + 2 + (pre-existing on both dates already counted)
    // afterCancel.attending = beforeCancel.attending - (all RSVPs on CANCEL_DATE)
    // We don't know the pre-existing count on CANCEL_DATE exactly, but we know the
    // test admin's RSVP on date A is the only new attending contribution.
    // Therefore: afterCancel.attending <= baseline.attending + 1
    // (at most: baseline + date-A test RSVP, because all CANCEL_DATE RSVPs were excluded)
    expect(afterCancel.attending).toBeLessThanOrEqual(baseline.attending + 1);

    // Occurrence count must have decreased by exactly 1 compared to the state
    // JUST BEFORE we cancelled (beforeCancel.occurrences). Using beforeCancel rather
    // than baseline prevents false failures if cancel-occurrence.spec.ts concurrently
    // changes the occurrence count between the baseline read and this assertion.
    expect(afterCancel.occurrences).toBe(beforeCancel.occurrences - 1);

    // ── Assert list page matches detail page ───────────────────────────────
    // The list page's expanded RSVP sub-row must show the same attending count.
    await page.goto(ADMIN_LIST_URL);
    await page.waitForLoadState("networkidle");
    const farmerMainRow = page.locator("tr").filter({ hasText: /Farmer/i }).first();
    await expect(farmerMainRow).toBeVisible({ timeout: 10000 });

    // EventTableRow splits across two <tr> siblings; check the table body as a whole.
    await expect(page.locator("tbody")).toContainText(
      `${afterCancel.attending} attending`,
      { timeout: 10000 }
    );
  });

  test("Test 3 — recurring event detail page shows rollup header with correct text — rollup-bug regression", async ({
    page,
  }) => {
    // Arrange — add RSVPs on date A and date B (two non-cancelled occurrences)
    await page.request.post(signupUrl, {
      data: { userId, occurrenceDate: ROLLUP_ISO_A },
    });
    await page.request.post(signupUrl, {
      data: { userId, occurrenceDate: ROLLUP_ISO_B },
    });

    // Act — navigate to the detail page
    await page.goto(ADMIN_DETAIL_URL);
    await page.waitForLoadState("networkidle");

    // Assert — rollup header is visible and contains the expected text pattern
    // "X attending across Y occurrences"
    const attendanceSection = page.locator("#attendance");
    await expect(attendanceSection).toBeVisible({ timeout: 10000 });

    // The IIFE-rendered rollup block with bg-blue-50 should appear
    const rollupBlock = attendanceSection.locator(".bg-blue-50").first();
    await expect(rollupBlock).toBeVisible({ timeout: 10000 });

    // Rollup header must contain "attending across" and "occurrences"
    await expect(rollupBlock).toContainText("attending across");
    await expect(rollupBlock).toContainText("occurrences");

    // Secondary line shows maybe/declined counts
    await expect(rollupBlock).toContainText("maybe");
    await expect(rollupBlock).toContainText("declined");
  });
});

test.describe("recurring-signup-rollup — non-recurring event path unchanged", () => {
  test("Test 4 — non-recurring event detail page has stat boxes and no rollup header — rollup-bug regression", async ({
    page,
  }) => {
    // Arrange — sign in as admin (the Lions Club Meeting is a private non-recurring event
    // that the admin can view)
    await signInAsAdmin(page);

    // Act — navigate to the non-recurring event's admin detail page
    await page.goto(NON_RECURRING_DETAIL_URL);
    await page.waitForLoadState("networkidle");

    // The Lions Club Meeting may or may not have an RSVP section depending on requiresRsvp.
    // The key invariant is that IF the RSVP section is shown, it must render the stat
    // boxes (Attending, Maybe, Declined, Guests) and must NOT render the rollup header
    // (.bg-blue-50 block that says "attending across").
    //
    // If there is no RSVP section (requiresRsvp is false), the attendance section (#attendance)
    // won't be on the page and the test passes trivially — but the absence of the rollup header
    // is still verified (it just isn't rendered at all).

    // Assert — the rollup header text ("attending across") does NOT appear anywhere on the page
    await expect(page.locator("body")).not.toContainText("attending across", { timeout: 10000 });

    // If the attendance section is present, verify it does NOT contain the rollup IIFE block.
    const attendanceSection = page.locator("#attendance");
    const hasSectionCount = await attendanceSection.count();
    if (hasSectionCount > 0) {
      // The stat grid (four colored boxes) should be present for non-recurring events with RSVPs
      // Verify the stat box labels appear
      await expect(attendanceSection).toContainText("Attending");
      await expect(attendanceSection).toContainText("Maybe");
      await expect(attendanceSection).toContainText("Declined");
      await expect(attendanceSection).toContainText("Guests");
    }
  });
});
