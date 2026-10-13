import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swPhotos, swSessions } from "../src/lib/db/schema";
import {
  adminPage,
  cleanupSession,
  collageToken,
  createPracticeSession,
  seedPhoto,
  seedStuffy,
  uploadGroupPhoto,
  uniqueSlug,
  type TestSession,
} from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop Slice 3 (e2e): the admin photos page and the public collage.
 * A practice session with generated PNGs seeded through the local photo store.
 * Fake stuffy names only; rows and files removed in afterAll.
 */
const SLUG = uniqueSlug("e2e-col");
const STARTED = new Date(Date.now() - 1000);
let sw: TestSession;
let token = "";
let groupA = "";
let groupB = "";
let groupReal = ""; // uploaded through the real route: created_at has microseconds (S3-D1)
let portraitYes = "";
let portraitNo = "";
let yesStuffyId = "";
const t0 = Date.now();

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG, true);
  await admin.close();
  token = await collageToken(sw.id);
});

test.afterAll(async () => {
  await cleanupSession(SLUG, STARTED);
});

// Seeded through the admin context so manual-add is authorised.
test("seed: three group photos (one through the real upload route), a consented portrait and a non-consented portrait", async ({ browser }) => {
  const admin = await adminPage(browser);
  const yesId = await seedStuffy(admin.request, sw.id, "Zed", true);
  yesStuffyId = yesId;
  const noId = await seedStuffy(admin.request, sw.id, "Moxie", false);
  groupReal = await uploadGroupPhoto(admin.request, SLUG, new Date(t0 + 500));
  await admin.close();
  groupA = await seedPhoto(sw.id, SLUG, { kind: "group", stuffyId: null, rgb: [200, 40, 40], takenAt: new Date(t0) });
  groupB = await seedPhoto(sw.id, SLUG, { kind: "group", stuffyId: null, rgb: [40, 160, 60], takenAt: new Date(t0 + 1000) });
  portraitYes = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: yesId, rgb: [40, 60, 200], takenAt: new Date(t0 + 2000) });
  portraitNo = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: noId, rgb: [220, 180, 20], takenAt: new Date(t0 + 3000) });
  expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test("pending: the printed link says when the photos arrive and lists nothing", async ({ page }) => {
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "The photos arrive on Saturday, Dec 19" })).toBeVisible();
  await expect(page.locator('img[src*="/api/santas-workshop/photos/"]')).toHaveCount(0);
  const door = await page.request.get(`/api/santas-workshop/photos/${groupA}?v=thumb`);
  expect(door.status()).toBe(404);
});

test("pending after the photo day has passed says the photos are being prepared", async ({ page }) => {
  await db.update(swSessions).set({ photoDate: "2020-01-04" }).where(eq(swSessions.id, sw.id));
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "The photos are being prepared" })).toBeVisible();
  await expect(page.getByText("Dec 19")).toHaveCount(0);
  await db.update(swSessions).set({ photoDate: "2026-12-19" }).where(eq(swSessions.id, sw.id));
});

test("an unknown token is a plain 404", async ({ page }) => {
  const res = await page.goto(`/santas-workshop/c/${"A".repeat(22)}`);
  expect(res?.status()).toBe(404);
});

test("publish is refused until the group photos are reviewed, and says how many", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/photos`);
  await expect(page.getByText("Hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies.")).toBeVisible();
  await expect(page.getByTestId("group-grid").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("portrait-grid").locator("li")).toHaveCount(2);
  await page.getByRole("button", { name: "Publish the collage" }).click();
  await expect(page.getByRole("region", { name: "Collage" }).getByRole("alert")).toContainText("3 group photos have not been reviewed yet.");
  await expect(page.getByRole("button", { name: "Publish the collage" })).toBeVisible();
  const [row] = await db.select({ p: swSessions.collagePublishedAt }).from(swSessions).where(eq(swSessions.id, sw.id));
  expect(row.p).toBeNull();
  await page.close();
});

test("markers: consent state, hidden and 'visible to a stranger' are shown", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/photos`);
  const no = page.locator(`[data-photo-id="${portraitNo}"]`);
  await expect(no).toContainText("Not on the collage: no consent");
  const yes = page.locator(`[data-photo-id="${portraitYes}"]`);
  await expect(yes).toContainText("On the collage: family agreed");
  // Nothing is visible to a stranger before publishing.
  await expect(page.getByText("Visible to anyone with the link")).toHaveCount(0);
  await page.close();
});

test("review, hide with a confirmation, then publish", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/photos`);

  // Hide group photo B: cancel first, then confirm.
  const tileB = page.locator(`[data-photo-id="${groupB}"]`);
  await tileB.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Hide this photo?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(tileB.getByText("Hidden", { exact: true })).toHaveCount(0);
  await tileB.getByRole("button", { name: "Hide" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Hide photo" }).click();
  await expect(tileB.getByText("Hidden", { exact: true })).toBeVisible();
  await expect(tileB.getByRole("button", { name: "Unhide" })).toBeVisible();

  await page.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(page.getByRole("button", { name: "Mark group photos reviewed" })).toBeDisabled();
  await page.getByRole("button", { name: "Publish the collage" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.locator(`[data-photo-id="${groupA}"]`)).toContainText("Visible to anyone with the link");
  // The newest photo, whose created_at has microseconds, is covered by the review and public after one publish.
  await expect(page.locator(`[data-photo-id="${groupReal}"]`)).toContainText("Visible to anyone with the link");
  await expect(page.locator(`[data-photo-id="${portraitYes}"]`)).toContainText("Visible to anyone with the link");
  await expect(page.locator(`[data-photo-id="${portraitNo}"]`)).not.toContainText("Visible to anyone with the link");
  await expect(page.getByLabel("Collage link")).toHaveValue(new RegExp(`/santas-workshop/c/${token}$`));
  await expect(page.getByAltText("QR code for the collage link")).toBeVisible();

  // Un-hiding a picture that was never published says it waits for "Publish late photos".
  await tileB.getByRole("button", { name: "Unhide" }).click();
  await expect(page.getByText("This picture returns to the collage when you press Publish late photos.")).toBeVisible();
  await expect(page.getByText("1 picture taken since the last publish is not yet public.")).toBeVisible();
  await tileB.getByRole("button", { name: "Hide" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Hide photo" }).click();
  await expect(tileB.getByText("Hidden", { exact: true })).toBeVisible();
  await page.close();
});

test("published page: group photos then only consented portraits, no names, and the right lines", async ({ page }) => {
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "Group pictures" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stuffy portraits" })).toBeVisible();
  await expect(page.getByTestId("collage-group").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("collage-portrait").locator("li")).toHaveCount(1);
  await expect(page.locator(`img[src*="${groupA}"]`)).toBeVisible();
  await expect(page.locator(`img[src*="${groupB}"]`)).toHaveCount(0); // hidden
  await expect(page.locator(`img[src*="${portraitYes}"]`)).toBeVisible();
  await expect(page.locator(`img[src*="${portraitNo}"]`)).toHaveCount(0); // no consent
  const img = page.locator(`img[src*="${groupA}"]`);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/Zed|Moxie/);
  await expect(page.getByText("We photograph stuffies only, never children.")).toBeVisible();
  await expect(page.getByText(/Changed your mind, or see someone who should not be in a picture\? Email/)).toBeVisible();
  await expect(page.getByRole("link", { name: "info@westervillelions.org" })).toHaveAttribute("href", "mailto:info@westervillelions.org");
  await expect(page.getByRole("link", { name: "Or use the contact form" })).toHaveAttribute("href", "/connect");
  // Site chrome is gone; only the club name header remains.
  await expect(page.getByRole("link", { name: "Donate" })).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  // Tap opens the full picture.
  await page.getByRole("button", { name: "Group picture 1" }).click();
  await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("src", new RegExp(`${groupA}\\?v=full`));
  await page.keyboard.press("Escape");
  // The door agrees with the page.
  expect((await page.request.get(`/api/santas-workshop/photos/${groupB}?v=thumb`)).status()).toBe(404);
  expect((await page.request.get(`/api/santas-workshop/photos/${portraitNo}?v=thumb`)).status()).toBe(404);
  expect((await page.request.get(`/api/santas-workshop/photos/${groupA}?v=thumb`)).status()).toBe(200);
});

test("hiding a photo in the admin makes it disappear from the public page", async ({ browser }) => {
  const admin = await adminPage(browser);
  await admin.goto(`/admin/santas-workshop/${sw.id}/photos`);
  const tile = admin.locator(`[data-photo-id="${groupA}"]`);
  await tile.getByRole("button", { name: "Hide" }).click();
  await admin.getByRole("alertdialog").getByRole("button", { name: "Hide photo" }).click();
  await expect(tile.getByText("Hidden", { exact: true })).toBeVisible();

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.locator(`img[src*="${groupA}"]`)).toHaveCount(0);
  // The real-route photo is still public, so the section stays with exactly one tile.
  await expect(page.getByTestId("collage-group").locator("li")).toHaveCount(1);
  expect((await page.request.get(`/api/santas-workshop/photos/${groupA}?v=thumb`)).status()).toBe(404);
  await stranger.close();

  // Unhide again so the next test has a group photo.
  await tile.getByRole("button", { name: "Unhide" }).click();
  await expect(tile.getByText("Hidden", { exact: true })).toHaveCount(0);
  await admin.close();
});

test("360 px: the published page and the admin page do not scroll sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "Group pictures" })).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await ctx.close();

  const admin = await adminPage(browser);
  await admin.setViewportSize({ width: 360, height: 740 });
  await admin.goto(`/admin/santas-workshop/${sw.id}/photos`);
  await expect(admin.getByRole("heading", { name: "Group photos" })).toBeVisible();
  expect(await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await admin.close();
});

test("a late photo from the real upload route: review once, then Publish late photos succeeds", async ({ browser }) => {
  const admin = await adminPage(browser);
  const late = await uploadGroupPhoto(admin.request, SLUG);
  await admin.goto(`/admin/santas-workshop/${sw.id}/photos`);
  const tile = admin.locator(`[data-photo-id="${late}"]`);
  await expect(tile).toContainText("Not reviewed yet");
  await admin.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(tile).not.toContainText("Not reviewed yet");

  // A portrait retaken AFTER the publish is private to strangers until the same batch button is pressed.
  await db.update(swPhotos).set({ supersededAt: new Date() }).where(eq(swPhotos.id, portraitYes));
  const retaken = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: yesStuffyId, rgb: [10, 200, 200], takenAt: new Date() });
  const stranger = await browser.newContext();
  expect((await stranger.request.get(`/api/santas-workshop/photos/${retaken}?v=thumb`)).status()).toBe(404);
  expect((await stranger.request.get(`/api/santas-workshop/photos/${late}?v=thumb`)).status()).toBe(404);
  await admin.reload();
  await expect(admin.locator(`[data-photo-id="${retaken}"]`)).not.toContainText("Visible to anyone with the link");

  await admin.getByRole("button", { name: "Publish late photos" }).click();
  await expect(tile).toContainText("Visible to anyone with the link");
  await expect(admin.locator(`[data-photo-id="${retaken}"]`)).toContainText("Visible to anyone with the link");
  expect((await stranger.request.get(`/api/santas-workshop/photos/${late}?v=thumb`)).status()).toBe(200);
  expect((await stranger.request.get(`/api/santas-workshop/photos/${retaken}?v=thumb`)).status()).toBe(200);
  expect((await stranger.request.get(`/api/santas-workshop/photos/${portraitYes}?v=thumb`)).status()).toBe(404); // superseded
  await stranger.close();
  await admin.close();
});

test("unpublish asks first, and the link goes back to pending", async ({ browser }) => {
  const admin = await adminPage(browser);
  await admin.goto(`/admin/santas-workshop/${sw.id}/photos`);
  await admin.getByRole("button", { name: "Unpublish" }).click();
  await expect(admin.getByRole("alertdialog")).toContainText("Unpublish the collage?");
  await admin.getByRole("alertdialog").getByRole("button", { name: "Unpublish" }).click();
  await expect(admin.getByRole("button", { name: "Publish the collage" })).toBeVisible();
  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: /The photos arrive on/ })).toBeVisible();
  await stranger.close();
  await admin.close();
});

test("removed: a publicly purged session says the photos have been removed", async ({ browser }) => {
  await db.update(swSessions).set({ publicPurgedAt: new Date() }).where(eq(swSessions.id, sw.id));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "These photos have been removed" })).toBeVisible();
  await expect(page.locator('img[src*="/api/santas-workshop/photos/"]')).toHaveCount(0);
  await ctx.close();
});
