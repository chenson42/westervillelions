/**
 * e2e regression tests for recurring event signup rollup (v1.16.1 fix).
 *
 * Before this fix the admin events list scoped each recurring event's signup count
 * to the next upcoming occurrence only. The detail page had no series-level summary
 * at all. Both are now fixed:
 *   - List page: sum RSVPs across all non-cancelled occurrences
 *   - Detail page: rollup header above the per-occurrence breakdown
 *
 * Self-seeding fixture (2026-09-25 remediation, docs/reviews/2026-09-25-test-coverage.md):
 * this suite used to point at a real seeded event ("Farmer's Market Signup",
 * id 291c76f3-ab75-4c64-8173-ac285345cfe9) with a hardcoded `recurrence_end_date`
 * of 2026-09-26 and hardcoded occurrence dates in June 2026. `ADMIN_LIST_URL`
 * ("/admin/events") defaults to `view=upcoming`, which
 * `src/app/(dashboard)/admin/events/page.tsx` scopes to
 * `recurrenceEndDate IS NULL OR recurrenceEndDate >= now` — so the moment "now"
 * passed 2026-09-26, the fixture series dropped out of the default list Tests 1
 * and 2 navigate to, and every assertion that reads the list page would have
 * started failing with no code regression at all. This is the exact defect
 * shape `cancel-occurrence.spec.ts` was rewritten to avoid on 2026-09-09 (see
 * that file's header comment) — this suite had the same shared, calendar-pinned
 * fixture and had simply not rotted yet.
 *
 * Fix: like `cancel-occurrence.spec.ts`, this suite now creates its own private,
 * RSVP-enabled, weekly-recurring event in a top-level `beforeAll`, with a rolling
 * window computed from the real wall-clock "now" at run time (first occurrence
 * 10 days out, recurring for 90 days), and deletes it in `afterAll` (pass or
 * fail). Because the window is always computed relative to "now", the fixture
 * can never again age out of the "upcoming" list — there is no fixed calendar
 * date left anywhere in this file for the clock to walk past. `events` ->
 * `event_occurrence_overrides` and `events` -> `event_rsvps` are both
 * `ON DELETE CASCADE` (schema.ts), so deleting the event is sufficient cleanup.
 *
 * A brand-new fixture also starts with an "attending" count of exactly 0 across
 * the whole run, which the old shared fixture (accumulating real member RSVPs
 * over months) never did — `readListAttending()` below is rewritten to scope
 * its read to this fixture's own table row (by its unique title) rather than
 * grabbing the first "✓ N attending" text anywhere in the page's `<tbody>`.
 * Without that scoping, a zero-RSVP fixture sorted after some other event with
 * real attendees would silently read the wrong row's count.
 *
 * Non-recurring target: "Lions Club Meeting" (id: 2a68b4c6-2068-4d5d-84d6-223167260c7b)
 *   Public non-recurring event used to verify the non-recurring path is unchanged.
 *   Left as a shared fixture on purpose: Test 4 only ever navigates to it by ID
 *   (`/admin/events/[id]`), which — confirmed by reading
 *   `src/app/(dashboard)/admin/events/[id]/page.tsx` — has no upcoming/past date
 *   filter at all (it queries `events` by primary key and generates all
 *   occurrences from the series' own start, independent of "now"). It is not
 *   exposed to the list-view date-rot mechanism this remediation targets.
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
import { addDays, format } from "date-fns";

const NON_RECURRING_EVENT_ID = "2a68b4c6-2068-4d5d-84d6-223167260c7b";

// Populated by the top-level beforeAll below — real fixture id/dates/title,
// computed relative to wall-clock "now" at run time, never hardcoded.
let EVENT_ID = "";
let FIXTURE_TITLE = "";
let userId = "";

let ROLLUP_DATE_A = "";
let ROLLUP_DATE_B = "";
let ROLLUP_CANCEL_DATE = "";
let ROLLUP_ISO_A = "";
let ROLLUP_ISO_B = "";
let ROLLUP_ISO_CANCEL = "";

const signupUrl = () => `/api/admin/events/${EVENT_ID}/signup`;
const cancelUrl = (date: string) =>
  `/api/admin/events/${EVENT_ID}/occurrences/${date}/cancel`;
const ADMIN_LIST_URL = "/admin/events";
const ADMIN_DETAIL_URL = () => `/admin/events/${EVENT_ID}`;
const NON_RECURRING_DETAIL_URL = `/admin/events/${NON_RECURRING_EVENT_ID}`;

// Fetch the current user's ID from the NextAuth session endpoint.
async function getCurrentUserId(page: import("@playwright/test").Page): Promise<string> {
  const resp = await page.request.get("/api/auth/session");
  expect(resp.status()).toBe(200);
  const data = await resp.json();
  const uid = data?.user?.id as string | undefined;
  if (!uid) throw new Error("Could not determine current user ID from session");
  return uid;
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAsAdmin(page);
  userId = await getCurrentUserId(page);

  // First occurrence 10 days out — comfortably clear of "now" under any
  // reasonable clock/timezone skew between the test runner and the app's
  // Eastern-wall-clock guard (nowEastern(), src/lib/events.ts), and clear of
  // cancel-occurrence.spec.ts's own fixture (which starts 7 days out) since
  // both suites may run in the same overall test session.
  const start = addDays(new Date(), 10);
  const dayOfWeek = start.getDay();
  const startDate = `${format(start, "yyyy-MM-dd")}T12:30`;
  // 90-day window — far past the 24-day-out occurrence these tests use, and
  // far short of MAX_OCCURRENCES (200) at a weekly cadence. Recomputed from
  // "now" every run, so this fixture can never again drift into the past.
  const recurrenceEndDate = `${format(addDays(start, 90), "yyyy-MM-dd")}T00:00`;

  FIXTURE_TITLE = `E2E QA Rollup Fixture ${Date.now()}`;

  const createResp = await page.request.post("/api/admin/events", {
    data: {
      title: FIXTURE_TITLE,
      startDate,
      isPublic: false, // private — doesn't pollute the public /events list
      requiresRsvp: true,
      isRecurring: true,
      recurrenceType: "weekly",
      recurrenceDays: [dayOfWeek],
      recurrenceEndDate,
    },
  });
  expect(
    createResp.ok(),
    `fixture event creation failed: ${createResp.status()} ${await createResp.text()}`
  ).toBe(true);
  const created = await createResp.json();
  EVENT_ID = created.id;

  // Three future occurrences of the weekly series — 10, 17, and 24 days out.
  ROLLUP_DATE_A = format(start, "yyyy-MM-dd");
  ROLLUP_DATE_B = format(addDays(start, 7), "yyyy-MM-dd");
  ROLLUP_CANCEL_DATE = format(addDays(start, 14), "yyyy-MM-dd");
  ROLLUP_ISO_A = `${ROLLUP_DATE_A}T12:30:00`;
  ROLLUP_ISO_B = `${ROLLUP_DATE_B}T12:30:00`;
  ROLLUP_ISO_CANCEL = `${ROLLUP_CANCEL_DATE}T12:30:00`;

  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  // Pass or fail, always clean up — cascades to event_occurrence_overrides
  // and event_rsvps (both ON DELETE CASCADE, schema.ts).
  if (!EVENT_ID) return;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAsAdmin(page);
  await page.request.delete(`/api/admin/events/${EVENT_ID}`);
  await ctx.close();
});

/**
 * Read the rollup header from the detail page and return the attending count and
 * occurrence count.  The header text looks like:
 *   "32 attending across 17 occurrences"
 */
async function readDetailRollup(
  page: import("@playwright/test").Page
): Promise<{ attending: number; occurrences: number }> {
  await page.goto(ADMIN_DETAIL_URL());
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
 * Read this fixture's own attending count from the admin events list page.
 *
 * The EventTableRow component renders the event as a main <tr> (with the
 * event's title) followed, only when `requiresRsvp && expanded`, by a sibling
 * <tr class="bg-blue-50"> holding text like "✓ N attending ~ 0 maybe" — see
 * src/components/admin/event-table-row.tsx. `expanded` defaults to true only
 * when the rollup total is > 0, so a fixture with zero RSVPs renders no
 * sub-row at all; that is 0 attending, not a missing element.
 *
 * We locate the row by this fixture's unique title rather than reading the
 * first "✓ N attending" match anywhere in the page, because the list can
 * contain other recurring events (real club events, or a concurrently-running
 * suite's own fixture) with their own nonzero attending counts sorted ahead
 * of ours.
 *
 * Caller must navigate to ADMIN_LIST_URL and wait for networkidle first.
 */
async function readListAttending(
  page: import("@playwright/test").Page
): Promise<number> {
  const mainRow = page.locator("tr").filter({ hasText: FIXTURE_TITLE }).first();
  await expect(mainRow).toBeVisible({ timeout: 10000 });

  const subRow = mainRow.locator("xpath=following-sibling::tr[1]");
  if ((await subRow.count()) === 0) return 0;

  const text = await subRow.innerText();
  const match = text.match(/✓\s*(\d+)\s+attending/);
  return match ? parseInt(match[1], 10) : 0;
}

// serial: tests share occurrence dates and the DB; must not run in parallel.
test.describe.serial("recurring-signup-rollup — list and detail page", () => {
  // Clean up all test RSVPs and overrides before each test so tests start from a known state.
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);

    // Remove any RSVPs for the three test dates
    for (const iso of [ROLLUP_ISO_A, ROLLUP_ISO_B, ROLLUP_ISO_CANCEL]) {
      await page.request.delete(signupUrl(), { data: { userId, occurrenceDate: iso } });
    }
    // Restore any cancelled dates
    for (const date of [ROLLUP_DATE_A, ROLLUP_DATE_B, ROLLUP_CANCEL_DATE]) {
      await page.request.post(cancelUrl(date), { data: { cancelled: false } });
    }
  });

  test("Test 1 — admin events list shows sum of RSVPs across two occurrences — rollup-bug regression", async ({
    page,
  }) => {
    // ── Phase 1: Capture list attending count before adding any RSVPs ──────
    // This is our own private fixture with no pre-existing RSVPs, so this is
    // expected to be exactly 0 — captured dynamically anyway rather than
    // hardcoded, since the point of this test is the DELTA the fix produces.
    await page.goto(ADMIN_LIST_URL);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText(FIXTURE_TITLE, { timeout: 10000 });
    const listBefore = await readListAttending(page);

    // ── Phase 2: Add RSVPs on two distinct occurrence dates ────────────────
    const respA = await page.request.post(signupUrl(), {
      data: { userId, occurrenceDate: ROLLUP_ISO_A },
    });
    expect([200, 201]).toContain(respA.status());

    const respB = await page.request.post(signupUrl(), {
      data: { userId, occurrenceDate: ROLLUP_ISO_B },
    });
    expect([200, 201]).toContain(respB.status());

    // ── Phase 3: Assert list page count increased by exactly 2 ─────────────
    // The regression test: the old code counted only the NEXT upcoming occurrence;
    // after the fix, BOTH dates A and B are counted. This fixture is private to
    // this test run, so the count is exact (no other test/suite can touch it).
    await page.goto(ADMIN_LIST_URL);
    await page.waitForLoadState("networkidle");
    const listAfter = await readListAttending(page);
    expect(listAfter).toBe(listBefore + 2);

    // ── Phase 4: Assert detail page rollup header exists ───────────────────
    // Before the fix, recurring events had NO series-level rollup header at all.
    // After the fix, the blue panel with "X attending across Y occurrences" must appear.
    await page.goto(ADMIN_DETAIL_URL());
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
    // admin user has no RSVPs on them. This fixture is private to this run,
    // so the baseline is deterministic (no concurrent suite can touch it).
    const baseline = await readDetailRollup(page);
    // baseline.occurrences includes ROLLUP_CANCEL_DATE (it is non-cancelled at this point).

    // ── Arrange: add RSVPs on date A and CANCEL_DATE ───────────────────────
    await page.request.post(signupUrl(), {
      data: { userId, occurrenceDate: ROLLUP_ISO_A },
    });
    await page.request.post(signupUrl(), {
      data: { userId, occurrenceDate: ROLLUP_ISO_CANCEL },
    });

    // ── Phase 2: Read rollup BEFORE cancellation ───────────────────────────
    // Both RSVPs are now counted, and only these two (this is a private fixture).
    const beforeCancel = await readDetailRollup(page);
    expect(beforeCancel.attending).toBe(baseline.attending + 2);

    // ── Cancel CANCEL_DATE ─────────────────────────────────────────────────
    // This removes CANCEL_DATE from the non-cancelled occurrence set, and the
    // RSVP on CANCEL_DATE must be excluded from the rollup. Only date A's RSVP
    // should remain from the two we added.
    const cancelResp = await page.request.post(cancelUrl(ROLLUP_CANCEL_DATE), {
      data: { cancelled: true, reason: "Rollup e2e test cancel" },
    });
    expect(cancelResp.status()).toBe(200);

    // ── Phase 3: Assert detail page rollup AFTER cancellation ──────────────
    await page.goto(ADMIN_DETAIL_URL());
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

    // Exact invariant, now that the fixture is private: only date A's RSVP
    // remains — CANCEL_DATE's RSVP (the only thing on that date) is excluded.
    expect(afterCancel.attending).toBe(baseline.attending + 1);

    // Occurrence count must have decreased by exactly 1.
    expect(afterCancel.occurrences).toBe(beforeCancel.occurrences - 1);

    // ── Assert list page matches detail page ───────────────────────────────
    // The list page's expanded RSVP sub-row must show the same attending count.
    await page.goto(ADMIN_LIST_URL);
    await page.waitForLoadState("networkidle");
    const mainRow = page.locator("tr").filter({ hasText: FIXTURE_TITLE }).first();
    await expect(mainRow).toBeVisible({ timeout: 10000 });

    const listAttending = await readListAttending(page);
    expect(listAttending).toBe(afterCancel.attending);
  });

  test("Test 3 — recurring event detail page shows rollup header with correct text — rollup-bug regression", async ({
    page,
  }) => {
    // Arrange — add RSVPs on date A and date B (two non-cancelled occurrences)
    await page.request.post(signupUrl(), {
      data: { userId, occurrenceDate: ROLLUP_ISO_A },
    });
    await page.request.post(signupUrl(), {
      data: { userId, occurrenceDate: ROLLUP_ISO_B },
    });

    // Act — navigate to the detail page
    await page.goto(ADMIN_DETAIL_URL());
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
