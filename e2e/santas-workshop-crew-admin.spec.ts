import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swOrders, swSessions, swStuffies } from "../src/lib/db/schema";
import { adminPage, cleanupSession, createPracticeSession, manualAdd, setStatus, uniqueSlug, WINDOW, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop Slice 2 (e2e: the admin controls). Status buttons with their
 * confirmations, the worker code card (show, rotate with confirmation, pause, resume),
 * Test storage and Check storage, manual add through the phone-usable dialog, the
 * registrant actions (dismiss a flag, refund Keep / Withdraw, withdraw with a reason,
 * go back a step on practice) and the awaiting-pickup CSV. Practice session; rows removed.
 */
const SLUG = uniqueSlug("e2e-adm");
const STARTED = new Date(Date.now() - 1000);
let sw: TestSession;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1400, height: 900 } });

test.beforeAll(async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG, false);
  await admin.close();
});

test.afterAll(async () => {
  await cleanupSession(SLUG, STARTED);
});

test("status buttons: activate, close with a confirmation, reopen", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}`);
  const status = page.getByRole("region", { name: "Session status" });
  await expect(status.getByText("Draft", { exact: true })).toBeVisible();
  await status.getByRole("button", { name: "Activate" }).click();
  await expect(status.getByText("Active", { exact: true })).toBeVisible();

  await status.getByRole("button", { name: "Close session" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Worker phones are locked out right away");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(status.getByText("Active", { exact: true })).toBeVisible();

  await status.getByRole("button", { name: "Close session" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close session" }).click();
  await expect(status.getByText("Closed", { exact: true })).toBeVisible();
  await status.getByRole("button", { name: "Reopen" }).click();
  await expect(status.getByText("Active", { exact: true })).toBeVisible();
  await page.close();
});

test("worker code card: show, rotate with a confirmation, pause, resume", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}`);
  const card = page.getByRole("region", { name: "Worker access" });
  await expect(card.getByText(/Live\./)).toBeVisible();

  await card.getByRole("button", { name: "Show code" }).click();
  const shown = card.locator("p.font-mono");
  await expect(shown).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const before = await shown.innerText();
  await expect(card.getByRole("button", { name: "Copy message for the crew" })).toBeVisible();

  await card.getByRole("button", { name: "Rotate code" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("signed out at once");
  await page.getByRole("alertdialog").getByRole("button", { name: "Rotate code" }).click();
  await expect(shown).not.toHaveText(before);

  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText(/Paused\. Phones are locked out/)).toBeVisible();
  await card.getByRole("button", { name: "Resume" }).click();
  await expect(card.getByText(/Live\./)).toBeVisible();
  await page.close();
});

test("Test storage and Check storage report in plain words", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}`);
  const card = page.getByRole("region", { name: "Photo storage" });
  await card.getByRole("button", { name: "Test storage" }).click();
  await expect(card.getByText(/Photo storage works/)).toBeVisible();
  // The card's "Last test" and the checklist update without a reload.
  await expect(card.getByText(/^Passed /)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Photo storage tested" }).getByText("Done")).toBeAttached();
  await card.getByRole("button", { name: "Check storage" }).click();
  await expect(card.getByText(/stray file|No stray files/)).toBeVisible();
  // Never the name of the storage service.
  expect(await card.innerText()).not.toMatch(/drive|google/i);
  await page.close();
});

test("manual add through the dialog; a missing reason is explained", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/registrants`);
  await page.getByRole("button", { name: "Add a registrant by hand" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Parent first name").fill("Walkin");
  await dialog.getByLabel("Parent last name").fill("Family");
  await dialog.getByLabel("Stuffy’s name").fill("Walkin Bear");
  await dialog.getByLabel("Drop-off window").selectOption(WINDOW.id);
  await dialog.getByRole("button", { name: "Add to the list" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/reason/i);
  await dialog.getByLabel(/Why you are adding this by hand/).fill("Phoned the chair");
  await dialog.getByRole("button", { name: "Add to the list" }).click();
  const row = page.locator("tr", { hasText: "Walkin Bear" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Added by hand")).toBeVisible();
  await page.close();
});

test("registrant actions: dismiss a flag, refund Keep, refund Withdraw, withdraw with a reason", async ({ browser }) => {
  const admin = await adminPage(browser);
  const flagged = await manualAdd(admin.request, sw.id, { stuffy: "Flagged Fox" });
  const kept = await manualAdd(admin.request, sw.id, { stuffy: "Kept Koala" });
  const gone = await manualAdd(admin.request, sw.id, { stuffy: "Gone Goat" });
  const plain = await manualAdd(admin.request, sw.id, { stuffy: "Plain Panda" });
  await db.update(swStuffies).set({ needsAttention: true, attentionCodes: ["missing_snack"] }).where(eq(swStuffies.id, flagged.id));
  await db.update(swOrders).set({ refundStatus: "full", refundedCents: 2500 }).where(eq(swOrders.id, kept.orderId));
  await db.update(swOrders).set({ refundStatus: "full", refundedCents: 2500 }).where(eq(swOrders.id, gone.orderId));

  await admin.goto(`/admin/santas-workshop/${sw.id}/registrants`);
  const row = (name: string) => admin.locator("tr", { hasText: name });

  await expect(row("Flagged Fox").getByText("Needs attention")).toBeVisible();
  await row("Flagged Fox").getByRole("button", { name: "Dismiss flag" }).click();
  await expect(row("Flagged Fox").getByText("Needs attention")).toHaveCount(0);

  await expect(row("Kept Koala").getByText("Refunded")).toBeVisible();
  await row("Kept Koala").getByRole("button", { name: "Refund: keep" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Keep it" }).click();
  await expect(row("Kept Koala").getByText("Refunded")).toHaveCount(0);

  await row("Gone Goat").getByRole("button", { name: "Refund: withdraw" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Withdraw them" }).click();
  await expect(row("Gone Goat").getByText("Withdrawn")).toBeVisible();

  await row("Plain Panda").getByRole("button", { name: "Withdraw", exact: true }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(/few words/);
  await dialog.getByLabel(/Why\?/).fill("Family cancelled");
  await dialog.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(row("Plain Panda").getByText("Withdrawn")).toBeVisible();
  await admin.close();
  void plain;
});

test("practice only: go back a step with a reason; the pickup list CSV lists who is waiting", async ({ browser }) => {
  const admin = await adminPage(browser);
  const waiting = await manualAdd(admin.request, sw.id, { stuffy: "Waiting Walrus" });
  await db.update(swStuffies).set({ state: "checked_in", tagCode: `E2E-ADM-${Date.now()}`, taggedAt: new Date(), checkedInAt: new Date() }).where(eq(swStuffies.id, waiting.id));

  await admin.goto(`/admin/santas-workshop/${sw.id}/registrants`);
  const row = admin.locator("tr", { hasText: "Waiting Walrus" });
  await row.getByRole("button", { name: /Go back a step/ }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Go back to").selectOption("registered");
  await dialog.getByLabel(/Why\?/).fill("Practice again");
  await dialog.getByRole("button", { name: "Go back" }).click();
  await expect(row.getByText("Registered", { exact: true })).toBeVisible();

  await db.update(swStuffies).set({ state: "checked_in", checkedInAt: new Date() }).where(eq(swStuffies.id, waiting.id));
  const csv = await admin.request.get(`/api/admin/santas-workshop/sessions/${sw.id}/awaiting-pickup.csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Waiting Walrus");

  await admin.goto(`/admin/santas-workshop/${sw.id}`);
  await expect(admin.getByText("Checked in, not yet picked up.")).toBeVisible();
  await expect(admin.getByRole("link", { name: "Download all stuffies not yet picked up (CSV)" })).toHaveAttribute("href", /awaiting-pickup\.csv$/);
  await setStatus(admin.request, sw.id, "closed");
  await admin.close();
});

test("a real session offers Revert last step, with a reason recorded in the history", async ({ browser }) => {
  const admin = await adminPage(browser);
  const slug = uniqueSlug("e2e-real");
  const created = await admin.request.post("/api/admin/santas-workshop/sessions", {
    data: { name: `E2E real ${slug}`, slug, kind: "real", dropoffDate: "2026-12-18", photoDate: "2026-12-19", pickupDate: "2026-12-20", windows: [WINDOW] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const realId = (await created.json()).session.id as string;
  try {
    const r = await manualAdd(admin.request, realId, { stuffy: "Wrong Wolf" });
    await manualAdd(admin.request, realId, { stuffy: "Snackless Seal" });
    await db.update(swStuffies).set({ state: "tagged", tagCode: `E2E-REAL-${Date.now()}`, taggedAt: new Date() }).where(eq(swStuffies.id, r.id));
    await admin.goto(`/admin/santas-workshop/${realId}/registrants`);
    const row = admin.locator("tr", { hasText: "Wrong Wolf" });
    await row.getByRole("button", { name: "Revert last step" }).click();
    const dialog = admin.getByRole("dialog");
    await expect(dialog).toContainText("recorded in the history");
    await expect(dialog.getByLabel("Go back to").locator("option")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/few words/);
    await dialog.getByLabel(/Why\?/).fill("Scanned the wrong sticker");
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(row.getByText("Registered", { exact: true })).toBeVisible();
    // A row that was never tagged has nothing to revert.
    await expect(admin.locator("tr", { hasText: "Snackless Seal" }).getByRole("button", { name: "Revert last step" })).toHaveCount(0);
  } finally {
    await db.delete(swSessions).where(eq(swSessions.slug, slug));
  }
  await admin.close();
});
