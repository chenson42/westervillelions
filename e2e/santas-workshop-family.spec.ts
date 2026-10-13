import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import jsQR from "jsqr";
import { db } from "../src/lib/db";
import { swOrders, swPhotos, swSessions, swStuffies } from "../src/lib/db/schema";
import { adminPage, cleanupSession, createPracticeSession, manualAdd, seedPhoto, setStatus, uniqueSlug, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop Slice 5 (e2e): the family page and retention. A practice session
 * with a seeded portrait, the pickup QR decoded from the rendered image, the family
 * page before and after publish, print to PDF, and the admin Retention card end to
 * end (refused before the date, forced with a reason, personal purge, public purge,
 * practice reset, real-session reset refused). Fake names only; rows removed afterwards.
 */
const SLUG = uniqueSlug("e2e-fam");
const SLUG_RESET = uniqueSlug("e2e-famr");
const SLUG_REAL = uniqueSlug("e2e-famx");
const STARTED = new Date(Date.now() - 1000);
let sw: TestSession;
let bellaId = "";
let familyToken = "";
let portraitId = "";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG);
  bellaId = (await manualAdd(admin.request, sw.id, { stuffy: "Bella", parentFirst: "Zelda", parentLast: "Famtest" })).id;
  await admin.close();
  portraitId = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: bellaId, rgb: [40, 60, 200], takenAt: new Date() });
  await db.update(swStuffies).set({ state: "portrait_taken" }).where(eq(swStuffies.id, bellaId));
  const [row] = await db.select({ t: swStuffies.familyToken }).from(swStuffies).where(eq(swStuffies.id, bellaId));
  familyToken = row.t;
});

test.afterAll(async () => {
  await cleanupSession(SLUG, STARTED);
  await cleanupSession(SLUG_RESET, STARTED);
  await cleanupSession(SLUG_REAL, STARTED);
});

async function decodeQr(page: Page, alt: string): Promise<string | null> {
  const img = page.getByAltText(alt);
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const data = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(i, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, px: Array.from(d.data) };
  });
  return jsQR(new Uint8ClampedArray(data.px), data.w, data.h)?.data ?? null;
}

test("an unknown, a malformed and a made-up token are the same plain 404", async ({ page }) => {
  for (const t of ["A".repeat(22), "short", "x".repeat(40)]) {
    const res = await page.goto(`/santas-workshop/f/${t}`);
    expect(res?.status(), t).toBe(404);
  }
  const door = await page.request.get(`/api/santas-workshop/family/${"A".repeat(22)}/portrait?v=full`);
  expect(door.status()).toBe(404);
});

test("pickup: the family QR on the worker's phone decodes to the family page and the page resolves", async ({ browser }) => {
  const admin = await adminPage(browser); // admins skip the worker code
  await admin.goto(`/santas-workshop/crew/${SLUG}`);
  await admin.getByRole("button", { name: "Stuffies" }).click();
  await admin.getByRole("button", { name: /^Bella/ }).first().click();
  await admin.getByRole("button", { name: "Show the name on the order" }).click();
  await admin.getByRole("button", { name: "Name matches" }).click();
  await admin.getByRole("button", { name: "Mark picked up" }).click();
  await expect(admin.getByText("Bella is picked up.")).toBeVisible();
  const payload = await decodeQr(admin, "QR code for the family's photo page");
  expect(payload).toBe(`${new URL(admin.url()).origin}/santas-workshop/f/${familyToken}`);
  const res = await admin.goto(payload!);
  expect(res?.status()).toBe(200);
  await expect(admin.getByRole("heading", { level: 1, name: "Bella" })).toBeVisible();
  await admin.close();
});

test("before publish: the portrait is already theirs (door 200), the photo day replaces the collage link, nothing indexable", async ({ page }) => {
  const res = await page.goto(`/santas-workshop/f/${familyToken}`);
  expect(res?.status()).toBe(200);
  const img = page.getByTestId("family-portrait");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const door = await page.request.get(`/api/santas-workshop/family/${familyToken}/portrait?v=full`);
  expect(door.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "The photos arrive on Saturday, Dec 19" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See the whole day's photos" })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByText("We photograph stuffies only, never children.")).toBeVisible();
  await expect(page.getByRole("link", { name: "info@westervillelions.org" })).toBeVisible();
  const html = await page.content();
  for (const secret of ["Famtest", "Zelda", "example.invalid", "555-0100"]) expect(html).not.toContain(secret);
});

test("after publish: both the portrait and the collage link; print renders", async ({ browser, page }) => {
  const admin = await adminPage(browser);
  const pub = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/publish`, { data: { action: "publish" } });
  expect(pub.status(), await pub.text()).toBe(200);
  await admin.close();

  await page.goto(`/santas-workshop/f/${familyToken}`);
  const img = page.getByTestId("family-portrait");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const door = await page.request.get(`/api/santas-workshop/family/${familyToken}/portrait?v=full`);
  expect(door.status()).toBe(200);
  const link = page.getByRole("link", { name: "See the whole day's photos" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/santas-workshop\/c\/[A-Za-z0-9_-]{22}$/);

  const collageHref = (await link.getAttribute("href"))!;

  // Print: the QR block exists in print media and decodes to the collage; the token is not printed as text.
  await page.emulateMedia({ media: "print" });
  const printed = await decodeQr(page, "QR code for the whole day's photos");
  expect(printed).toBe(new URL(collageHref, page.url()).toString());
  await expect(page.getByText("Scan to see the whole day's photos")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print this page" })).toBeHidden();
  // A real portrait is far larger than the seeded 120x160 PNG: stretch it so the print height cap is what limits it.
  await img.evaluate((i: HTMLImageElement) => {
    i.style.setProperty("height", "1600px", "important");
  });
  const pdf = await page.pdf({ format: "Letter", printBackground: false });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  // The takedown paragraph stays with the page above it (no stranded last sheet at Letter), with the published variant (portrait, QR block and footer).
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
  await page.emulateMedia({ media: "screen" });
  expect(portraitId).not.toBe("");
});

test("registrants: a checked-in stuffy with no check-in photo is listed and counted", async ({ browser }) => {
  const admin = await adminPage(browser);
  await admin.goto(`/admin/santas-workshop/${sw.id}`);
  await expect(admin.getByTestId("no-checkin-photo-tile")).toContainText("1");
  await admin.goto(`/admin/santas-workshop/${sw.id}/registrants?flag=no_checkin_photo`);
  await expect(admin.locator("table span").filter({ hasText: /^No check-in photo$/ })).toHaveCount(1);
  await expect(admin.locator("table").getByText("Bella")).toBeVisible();
  await admin.close();
});

test("retention: refused before the date, then forced with a reason; the personal purge keeps the family page", async ({ browser, page }) => {
  const admin = await adminPage(browser);
  await setStatus(admin.request, sw.id, "closed");
  await admin.goto(`/admin/santas-workshop/${sw.id}`);

  // The server refuses a plain run before the date.
  const refused = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/purge`, { data: { phase: "personal" } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("not_eligible");

  const card = admin.getByRole("region", { name: "Retention" });
  await expect(card.getByTestId("retention-personal")).toContainText("Not yet");
  await card.getByRole("button", { name: "Purge personal data" }).click();
  const dialog = admin.getByRole("alertdialog");
  await expect(dialog).toContainText("cannot be undone");
  await expect(dialog).toContainText("Do not type any family's name here.");
  const confirm = dialog.getByRole("button", { name: "Purge personal data" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason (kept in the session history)").fill("end-to-end test run");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(card.getByTestId("retention-personal")).toContainText("Purged");

  // Registrant names are gone from the admin list; the stuffy's own name and family page remain.
  await admin.goto(`/admin/santas-workshop/${sw.id}/registrants`);
  await expect(admin.locator("table").getByText("Bella")).toBeVisible();
  expect(await admin.content()).not.toContain("Famtest");
  const [order] = await db.select({ f: swOrders.buyerFirstName }).from(swOrders).where(eq(swOrders.sessionId, sw.id));
  expect(order.f).toBeNull();

  await page.goto(`/santas-workshop/f/${familyToken}`);
  await expect(page.getByTestId("family-portrait")).toBeVisible();
  await admin.close();
});

test("retention: the public purge removes the photos; the family page says removed and the door is 404", async ({ browser, page }) => {
  const admin = await adminPage(browser);
  await admin.goto(`/admin/santas-workshop/${sw.id}`);
  const card = admin.getByRole("region", { name: "Retention" });
  await card.getByRole("button", { name: "Take photos down" }).click();
  const dialog = admin.getByRole("alertdialog");
  await dialog.getByLabel("Reason (kept in the session history)").fill("end-to-end test run");
  await dialog.getByRole("button", { name: "Take photos down" }).click();
  await expect(card.getByTestId("retention-public")).toContainText("Purged");
  await admin.close();

  await page.goto(`/santas-workshop/f/${familyToken}`);
  await expect(page.getByRole("heading", { name: "These photos have been removed" })).toBeVisible();
  await expect(page.getByTestId("family-portrait")).toHaveCount(0);
  const door = await page.request.get(`/api/santas-workshop/family/${familyToken}/portrait?v=full`);
  expect(door.status()).toBe(404);
  const rows = await db.select({ p: swPhotos.purgedAt }).from(swPhotos).where(eq(swPhotos.sessionId, sw.id));
  expect(rows.every((r) => r.p !== null)).toBe(true);
});

test("reset: a practice session is emptied behind a confirmation; a real session refuses", async ({ browser }) => {
  const admin = await adminPage(browser);
  const prac = await createPracticeSession(admin.request, SLUG_RESET);
  const id = (await manualAdd(admin.request, prac.id, { stuffy: "Pip" })).id;
  await seedPhoto(prac.id, SLUG_RESET, { kind: "portrait", stuffyId: id, rgb: [200, 40, 40], takenAt: new Date() });

  await admin.goto(`/admin/santas-workshop/${prac.id}`);
  const card = admin.getByRole("region", { name: "Retention" });
  await card.getByRole("button", { name: "Reset practice session" }).click();
  const dialog = admin.getByRole("alertdialog");
  await expect(dialog).toContainText("cannot be undone");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await db.select().from(swStuffies).where(eq(swStuffies.sessionId, prac.id))).length).toBe(1);

  await card.getByRole("button", { name: "Reset practice session" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Reset practice session" }).click();
  await expect.poll(async () => (await db.select().from(swStuffies).where(eq(swStuffies.sessionId, prac.id))).length).toBe(0);
  expect((await db.select().from(swPhotos).where(eq(swPhotos.sessionId, prac.id))).length).toBe(0);
  expect((await db.select().from(swSessions).where(eq(swSessions.id, prac.id))).length).toBe(1);

  // A real session never shows the button, and the route refuses it.
  const created = await admin.request.post("/api/admin/santas-workshop/sessions", {
    data: { name: `E2E real ${SLUG_REAL}`, slug: SLUG_REAL, kind: "real", dropoffDate: "2026-12-18", photoDate: "2026-12-19", pickupDate: "2026-12-20", windows: [{ id: "w1", label: "5:00 PM – 6:00 PM", start: "17:00", end: "18:00" }] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const realId = (await created.json()).session.id as string;
  const refused = await admin.request.post(`/api/admin/santas-workshop/sessions/${realId}/reset`, { data: {} });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("practice_only");
  await admin.goto(`/admin/santas-workshop/${realId}`);
  await expect(admin.getByRole("button", { name: "Reset practice session" })).toHaveCount(0);
  await admin.close();
});
