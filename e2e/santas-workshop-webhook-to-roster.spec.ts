import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swSessions, swStuffies, zeffyEvents } from "../src/lib/db/schema";
import { signZeffyBody } from "../src/lib/zeffy/test-helpers";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Santa's Workshop Slice 1 (Phase 3, e2e spec 2, UI half): create a practice
 * session in the admin UI, connect a fixture campaign by hand, post a signed
 * three-ticket fixture to the real webhook, see three registrants flagged for
 * attention with the buyer's raw text visible and rendered as TEXT, assign the
 * questions in the UI and Remap, then repost (still three), post a bad
 * signature (400) and an unmapped-campaign event (nothing stored).
 *
 * Needs the dev server started with the SAME made-up secret:
 *   ZEFFY_WEBHOOK_SECRET=whsec_devexample PORT=3101 pnpm dev
 *   ZEFFY_WEBHOOK_SECRET=whsec_devexample PLAYWRIGHT_BASE_URL=http://localhost:3101 pnpm test:e2e e2e/santas-workshop-webhook-to-roster.spec.ts
 * Skipped (not failed) when the secret is not a whsec_dev value. example.invalid
 * data only; the session and its events are deleted afterwards.
 */

const SECRET = process.env.ZEFFY_WEBHOOK_SECRET ?? "";
const STAMP = Date.now();
const SLUG = `e2e-sw-${STAMP}`;
const CAMPAIGN = `e2e-campaign-${STAMP}`;
const OTHER_CAMPAIGN = `e2e-other-${STAMP}`;
const PAYMENT_ID = `00000000-0000-4000-8000-${String(STAMP).slice(-12).padStart(12, "0")}`;
const EVENT_ID = `e2e-event-${STAMP}`;

test.describe.configure({ mode: "serial" });
test.skip(!SECRET.startsWith("whsec_dev"), "Set ZEFFY_WEBHOOK_SECRET=whsec_dev... (the same value the dev server uses)");

function fixtureBody(opts: { eventId: string; campaign: string; paymentId: string }): string {
  const payment = JSON.parse(readFileSync(join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "payment-three-tickets.json"), "utf8"));
  payment.id = opts.paymentId;
  payment.campaign_id = opts.campaign;
  payment.items.forEach((it: { id: string }, i: number) => {
    it.id = `${opts.paymentId}-item-${i + 1}`;
  });
  return JSON.stringify({ id: opts.eventId, type: "payment.completed", version: 1, dispatchedAt: new Date().toISOString(), data: payment });
}

async function post(request: import("@playwright/test").APIRequestContext, body: string, signature?: string) {
  return request.post("/api/zeffy/webhook", {
    data: body,
    headers: { "content-type": "application/json", ...(signature ? { "zeffy-signature": signature } : {}) },
  });
}

const sign = (body: string) => signZeffyBody(SECRET, body, Math.floor(Date.now() / 1000));

let sessionId = "";

test.afterAll(async () => {
  // Cascades remove orders, stuffies, stuffy events and the session log.
  await db.delete(zeffyEvents).where(eq(zeffyEvents.campaignId, CAMPAIGN));
  await db.delete(zeffyEvents).where(eq(zeffyEvents.campaignId, OTHER_CAMPAIGN));
  await db.delete(swSessions).where(eq(swSessions.slug, SLUG));
});

test("create a practice session in the admin UI", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/santas-workshop/new");

  // Pre-filled from the club's 2026 facts: three windows, the real dates.
  await expect(page.getByLabel("Drop-off day")).toHaveValue("2026-12-18");
  await expect(page.locator('input[id^="sw-w-label-"]')).toHaveCount(3);

  await page.getByRole("radio", { name: /Practice/ }).check();
  await page.getByLabel("Short name for web addresses").fill(SLUG);
  // The window labels must read exactly as the Zeffy form's answers do: match the fixture's.
  await page.locator("#sw-w-label-1").fill("5:00 PM \u2013 6:00 PM");
  await page.getByRole("button", { name: "Create practice session" }).click();

  await page.waitForURL(/\/admin\/santas-workshop\/[0-9a-f-]{36}$/);
  sessionId = page.url().split("/").pop() ?? "";
  await expect(page.getByRole("heading", { level: 1 })).toContainText("dry run");
  await expect(page.getByText("Go-live checklist")).toBeVisible();
  await expect(page.getByText(`Short name: ${SLUG}`)).toBeVisible();
});

test("a duplicate short name is refused in plain words", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/santas-workshop/new");
  await page.getByRole("radio", { name: /Practice/ }).check();
  await page.getByLabel("Short name for web addresses").fill(SLUG);
  await page.getByRole("button", { name: "Create practice session" }).click();
  await expect(page.getByText(/already used by another session/)).toBeVisible();
});

test("connect a campaign by hand through the confirm dialog", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/connect`);
  const details = page.locator("details", { hasText: "Enter the form by hand" });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
  await page.getByLabel("Zeffy form id").fill(CAMPAIGN);
  await page.getByLabel("Stuffy ticket rate ids").fill("rate-stuffy");
  await page.getByLabel("Form title (optional)").fill("E2E practice form");
  await details.getByRole("button", { name: "Connect this form" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("E2E practice form");
  await dialog.getByRole("button", { name: "Connect form" }).click();
  await expect(page.getByText("Connected form")).toBeVisible();
  await expect(page.getByText("E2E practice form").first()).toBeVisible();
});

test("webhook: bad signature 400 and nothing stored, unmapped campaign stores no registrants", async ({ request }) => {
  const body = fixtureBody({ eventId: `${EVENT_ID}-bad`, campaign: CAMPAIGN, paymentId: PAYMENT_ID });
  const forged = await post(request, body, `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`);
  expect(forged.status()).toBe(400);
  const missing = await post(request, body);
  expect(missing.status()).toBe(400);
  expect(await db.select().from(zeffyEvents).where(eq(zeffyEvents.id, `${EVENT_ID}-bad`))).toHaveLength(0);

  const other = fixtureBody({ eventId: `${EVENT_ID}-other`, campaign: OTHER_CAMPAIGN, paymentId: `${PAYMENT_ID}-x` });
  const res = await post(request, other, sign(other));
  expect(res.status()).toBe(200);
  expect((await res.json()).outcome).toBe("ignored_unmapped");
  const [row] = await db.select().from(zeffyEvents).where(eq(zeffyEvents.id, `${EVENT_ID}-other`));
  expect(row.payload).toBeNull();
});

test("a signed three-ticket order becomes three registrants needing attention; a redelivery adds none", async ({ request, page }) => {
  const body = fixtureBody({ eventId: EVENT_ID, campaign: CAMPAIGN, paymentId: PAYMENT_ID });
  const first = await post(request, body, sign(body));
  expect(first.status()).toBe(200);
  expect((await first.json()).outcome).toBe("processed");

  const again = await post(request, body, sign(body));
  expect(again.status()).toBe(200);
  expect((await again.json()).duplicate).toBe(true);
  expect(await db.select().from(swStuffies).where(eq(swStuffies.sessionId, sessionId))).toHaveLength(3);

  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants`);
  await expect(page.getByText(/Showing 1 to 3 of 3/)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  // The stuffy-name question is not mapped yet, so the name falls back to the order-size placeholder.
  await expect(page.getByRole("heading", { level: 3, name: "Unnamed stuffy, order of 3" }).first()).toBeVisible();
  // Buyer text is untrusted: the markup is shown as characters, never interpreted.
  await expect(page.getByText("<b>Sir Hops-a-Lot</b>").first()).toBeVisible();
  expect(await page.locator("main b, body b:has-text('Sir Hops-a-Lot')").count()).toBe(0);
  // Needs-attention rows show the raw question and answer that matched nothing.
  await expect(page.locator("span", { hasText: "Needs attention" }).first()).toBeVisible();
  await expect(page.getByText("What the buyer answered to questions not matched yet:").first()).toBeVisible();
  await expect(page.getByText("A brown bear with a blue ribbon").first()).toBeVisible();
  // No horizontal scroll at 360px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // Search and the attention filter.
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?q=exampleton`);
  await expect(page.getByText(/Showing 1 to 3 of 3/)).toBeVisible();
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?q=nobody-by-this-name`);
  await expect(page.getByText("No one matches those filters.")).toBeVisible();
});

test("assigning the questions in the UI and re-reading clears the attention flags", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/connect`);
  await expect(page.getByText(/questions? not matched yet/)).toBeVisible();

  const map: Record<string, string[]> = JSON.parse(readFileSync(join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "question-map-practice.json"), "utf8"));
  const fieldLabel: Record<string, string> = {
    stuffy_name: "Stuffy name",
    stuffy_description: "What the stuffy is",
    snack: "Snack choice",
    note_to_santa: "Note to Santa",
    care_note: "Care note",
    photo_consent: "Photo sharing",
    buyer_phone: "Parent mobile",
    dropoff_window: "Drop-off window",
    acknowledgment: "Acknowledgment",
  };
  const assign = async (question: string, labelPrefix: string) => {
    const select = page.locator("li").filter({ has: page.locator("p.font-medium", { hasText: question }) }).locator("select").first();
    const value = await select.evaluate((el, p) => [...(el as HTMLSelectElement).options].find((o) => o.text.startsWith(p))?.value ?? "", labelPrefix);
    expect(value, `${labelPrefix} option for ${question}`).not.toBe("");
    await select.selectOption(value);
  };
  for (const [field, strings] of Object.entries(map)) {
    for (const text of strings) await assign(text, fieldLabel[field]);
  }
  // The one question the practice map does not cover is deliberately ignored.
  await assign("Anything else we should know", "Ignore");

  await page.getByRole("button", { name: "Save and re-read registrants" }).click();
  await expect(page.getByText(/Re-read 3 registrants/)).toBeVisible();

  await page.goto(`/admin/santas-workshop/${sessionId}`);
  await expect(page.locator("dt", { hasText: "Need attention" }).locator("xpath=following-sibling::dd[1]")).toHaveText("0");
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?q=biscuit`);
  await expect(page.getByText(/Showing 1 to 1 of 1/)).toBeVisible();
  await expect(page.getByText("Biscuit", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  const [s] = await db.select().from(swSessions).where(eq(swSessions.id, sessionId));
  expect(Object.keys(s.questionMap)).toContain("ignored");
});

test("sync is blocked with a clear reason when no Zeffy API key is set", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/connect`);
  const sync = page.getByRole("button", { name: "Sync from Zeffy" });
  // Whether the dev server has a key or not, the button state matches the explanation shown.
  if (await sync.isDisabled()) await expect(page.getByText(/API key is not set on this server/).first()).toBeVisible();
  await expect(page.getByText("Recent Zeffy events")).toBeVisible();
  await expect(page.getByText("Processed").first()).toBeVisible();

  // Every Slice 1 page fits a 360px phone with no sideways scroll.
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ["", "/connect", "/registrants"]) {
    await page.goto(`/admin/santas-workshop/${sessionId}${path}`);
    await expect(page.getByRole("heading", { level: 1, name: /dry run/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), path || "overview").toBe(true);
  }
  await page.goto("/admin/santas-workshop/new");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "new").toBe(true);
});
