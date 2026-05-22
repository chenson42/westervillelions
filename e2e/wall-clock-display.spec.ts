/**
 * e2e regression guard for the wall-clock display bug (v1.14.0 fix).
 *
 * The bug: event.startDate stored as "YYYY-MM-DD HH:MM:SS" wall-clock was being
 * interpreted as UTC, causing times to shift by the local UTC offset.
 * Example: 7:00 PM wall-clock → displayed as "3:00 PM" (4-hour EDT shift).
 *
 * This test pins a known future event's stored wall-clock time to its expected
 * displayed text on /events, then asserts the UTC-shifted variant does NOT appear.
 *
 * Target event: "Lions Club Meeting" (id: 2a68b4c6-2068-4d5d-84d6-223167260c7b)
 *   stored start_date: "2026-05-21 19:00:00" (wall-clock 7:00 PM)
 *   expected display: "7:00 PM"
 *   UTC-shifted wrong display (EDT = UTC-4): "11:00 PM" — must NOT appear
 *   UTC-shifted wrong display (EST = UTC-5): "12:00 AM" — must NOT appear
 *
 * The event detail page is used (not /events listing) because the detail page
 * always shows the formatted time via formatEventWhen(), whereas the listing page
 * shows a recurrence label for recurring events that may omit the time.
 *
 * Coverage closed: Gap #2 — wall-clock display regression guard.
 */

import { test, expect } from "@playwright/test";

// Non-recurring future public event with a known wall-clock time.
// stored start_date in DB: "2026-05-21 19:00:00" → expected display "7:00 PM"
const EVENT_ID = "2a68b4c6-2068-4d5d-84d6-223167260c7b";
const EXPECTED_TIME_TEXT = "7:00 PM";
// The UTC-shifted variants that should NOT appear if the bug returned
const WRONG_TIME_UTC_MINUS_4 = "11:00 PM"; // 19:00 + 4 = 23:00 → 11:00 PM
const WRONG_TIME_UTC_MINUS_5 = "12:00 AM"; // 19:00 + 5 = 24:00 → 12:00 AM next day

test.describe("wall-clock display — regression guard for UTC misclassification bug", () => {
  test("event detail page displays stored wall-clock time, not UTC-shifted time — regression for naive-timestamp-as-UTC bug", async ({
    page,
  }) => {
    // Arrange — navigate to the event detail page (public, no auth required)
    await page.goto(`/events/${EVENT_ID}`);

    // Assert — the page loads successfully
    await expect(page).toHaveURL(/\/events\//);
    await expect(page.locator("h1")).toBeVisible();

    // Assert — the correct wall-clock time appears somewhere on the page
    // formatEventWhen returns "Thursday, May 21, 2026 at 7:00 PM"
    await expect(page.locator("body")).toContainText(EXPECTED_TIME_TEXT);

    // Assert — the UTC-shifted wrong variants do NOT appear
    // If parseWallClock broke and the time shifted, one of these would appear instead
    await expect(page.locator("body")).not.toContainText(WRONG_TIME_UTC_MINUS_4);
    await expect(page.locator("body")).not.toContainText(WRONG_TIME_UTC_MINUS_5);
  });
});
