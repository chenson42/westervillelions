import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swSessions, zeffyEvents } from "../src/lib/db/schema";
import { signZeffyBody } from "../src/lib/zeffy/test-helpers";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Santa's Workshop session edit page (Phase 3 addendum): a window label mistyped
 * at creation is fixed from the edit page. Create a practice session with a
 * wrong label, connect a fixture campaign, map the questions, post a signed
 * order, see the registrant flagged, use the "answers that matched no window"
 * chip, Save, Remap, and watch the flag clear; then prove it reverses; an
 * in-use window cannot be removed; kind and slug are text; the gate; 360 px.
 *
 * Dev server: ZEFFY_WEBHOOK_SECRET=whsec_devexample PORT=3101 pnpm dev
 * Runner:     ZEFFY_WEBHOOK_SECRET=whsec_devexample PLAYWRIGHT_BASE_URL=http://localhost:3101 pnpm test:e2e e2e/santas-workshop-session-edit.spec.ts
 * Skipped without a whsec_dev secret. example.invalid data; everything is deleted afterwards.
 */

const SECRET = process.env.ZEFFY_WEBHOOK_SECRET ?? "";
const STAMP = Date.now();
const SLUG = `e2e-edit-${STAMP}`;
const CAMPAIGN = `e2e-edit-campaign-${STAMP}`;
const PAYMENT_ID = `00000000-0000-4000-8000-${String(STAMP).slice(-12).padStart(12, "0")}`;
const TYPO = "5:00 PM - 6:00 PM"; // hyphen; the buyers answered with an en dash
const ANSWER = "5:00 PM – 6:00 PM";
const NO_WINDOW = /matches none of this session/;

test.describe.configure({ mode: "serial" });
test.skip(!SECRET.startsWith("whsec_dev"), "Set ZEFFY_WEBHOOK_SECRET=whsec_dev... (the same value the dev server uses)");

let sessionId = "";

test.afterAll(async () => {
  await db.delete(zeffyEvents).where(eq(zeffyEvents.campaignId, CAMPAIGN));
  await db.delete(swSessions).where(eq(swSessions.slug, SLUG));
});

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function runRemap(page: Page) {
  await page.getByRole("button", { name: "Run Remap now" }).click();
  await expect(page.getByText(/Re-read 3 registrants/)).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Registrants are not updated until you run Remap/)).toBeVisible();
}

test("create a practice session with a mistyped window label, connect and map it, and post a signed order", async ({ page, request }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/santas-workshop/new");
  await page.getByRole("radio", { name: /Practice/ }).check();
  await page.getByLabel("Short name for web addresses").fill(SLUG);
  await page.locator("#sw-w-label-1").fill(TYPO);
  // The submit button names the kind it creates.
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/admin\/santas-workshop\/[0-9a-f-]{36}$/);
  sessionId = page.url().split("/").pop() ?? "";

  const map = JSON.parse(readFileSync(join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "question-map-practice.json"), "utf8"));
  const connect = await page.request.put(`/api/admin/santas-workshop/sessions/${sessionId}/zeffy`, {
    data: { campaignId: CAMPAIGN, ticketRateIds: ["rate-stuffy"], campaignTitle: "E2E edit form" },
  });
  expect(connect.status()).toBe(200);
  const saved = await page.request.put(`/api/admin/santas-workshop/sessions/${sessionId}/zeffy/question-map`, {
    data: { map: { ...map, ignored: ["anything else we should know"] } },
  });
  expect(saved.status()).toBe(200);

  const payment = JSON.parse(readFileSync(join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "payment-three-tickets.json"), "utf8"));
  payment.id = PAYMENT_ID;
  payment.campaign_id = CAMPAIGN;
  payment.items.forEach((it: { id: string }, i: number) => (it.id = `${PAYMENT_ID}-item-${i + 1}`));
  const body = JSON.stringify({ id: `e2e-edit-event-${STAMP}`, type: "payment.completed", version: 1, dispatchedAt: new Date().toISOString(), data: payment });
  const res = await request.post("/api/zeffy/webhook", {
    data: body,
    headers: { "content-type": "application/json", "zeffy-signature": signZeffyBody(SECRET, body, Math.floor(Date.now() / 1000)) },
  });
  expect(res.status()).toBe(200);

  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?flag=attention`);
  await expect(page.getByText(/Showing 1 to 3 of 3/)).toBeVisible();
  await expect(page.getByText(NO_WINDOW).filter({ visible: true }).first()).toBeVisible();
});

test("the chip fixes the label: Save, then Remap clears the flag and the window shows", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await expect(page.getByRole("heading", { name: "Answers that matched no window" })).toBeVisible();
  const chip = page.getByRole("button", { name: /5:00 PM – 6:00 PM \(1 order\)/ });
  await expect(chip).toBeVisible();

  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.locator("#sw-w-label-1").click();
  await chip.click();
  await expect(page.locator("#sw-w-label-1")).toHaveValue(ANSWER);
  await save(page);
  await runRemap(page);

  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?flag=attention`);
  await expect(page.getByText("No one matches those filters.")).toBeVisible();
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants`);
  await expect(page.getByText(ANSWER).filter({ visible: true }).first()).toBeVisible();
});

test("a wrong label flags them again, and restoring it reverses that", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await page.locator("#sw-w-label-1").fill("Some other label");
  await save(page);
  await runRemap(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?flag=attention`);
  await expect(page.getByText(/Showing 1 to 3 of 3/)).toBeVisible();
  await expect(page.getByText(NO_WINDOW).filter({ visible: true }).first()).toBeVisible();

  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await page.locator("#sw-w-label-1").click();
  await page.getByRole("button", { name: /5:00 PM – 6:00 PM \(1 order\)/ }).click();
  await save(page);
  await runRemap(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/registrants?flag=attention`);
  await expect(page.getByText("No one matches those filters.")).toBeVisible();
});

test("removing a window registrants chose is refused in plain words and saves nothing", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await page.getByRole("button", { name: /^Remove window 5:00/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Registrants chose this window; change its label instead of removing it." })).toBeVisible();
  const [row] = await db.select().from(swSessions).where(eq(swSessions.id, sessionId));
  expect(row.windows).toHaveLength(3);
});

test("kind and slug are text, never inputs", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await expect(page.getByText("Fixed once created")).toBeVisible();
  await expect(page.getByText(SLUG, { exact: true })).toBeVisible();
  expect(await page.locator('input[name="kind"], input[name="slug"], #sw-slug, #sw-kind').count()).toBe(0);
  expect(await page.locator("input").evaluateAll((els, slug) => els.some((e) => (e as HTMLInputElement).value === slug), SLUG)).toBe(false);
});

test("name and dates saved on the edit page show on the overview, and Recalculate proposes without saving", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await page.getByLabel("Session name").fill("Renamed dry run");
  await page.getByLabel("Pickup day").fill("2026-12-27");
  await page.getByRole("button", { name: /Recalculate worker access/ }).click();
  await expect(page.getByLabel("Worker access closes")).toHaveValue("2026-12-28");
  await expect(page.getByLabel("Remove personal details on")).toHaveValue("2027-01-26");
  const [before] = await db.select().from(swSessions).where(eq(swSessions.id, sessionId));
  expect(before.crewClosesOn).not.toBe("2026-12-28"); // proposed, not saved

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Session saved.")).toBeVisible();
  await page.goto(`/admin/santas-workshop/${sessionId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Renamed dry run" })).toBeVisible();
  await expect(page.getByText(/Dec\w* 27/).first()).toBeVisible();
});

test("the edit page fits a 360px phone", async ({ page }) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/admin/santas-workshop/${sessionId}/edit`);
  await expect(page.getByRole("heading", { level: 1, name: "Renamed dry run" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});
