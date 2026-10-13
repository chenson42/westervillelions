import { test, expect, type Page } from "@playwright/test";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swPhotos, swStuffies } from "../src/lib/db/schema";
import { PNG_FILE, adminPage, cleanupSession, createPracticeSession, crewContext, enterCode, expectRowState, manualAdd, uniqueSlug, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop Slice 2 (e2e: the worker's whole process on a 360 px phone, local
 * photo store). Tag by typing a sticker code, move it with a confirmation, check in
 * with a photo that goes through the outbox, portrait and retake (one current
 * portrait), pickup refused before the name check and then done, a second tap says
 * "already picked up", group photo, the scan screen's "Tag it now", and a photo
 * taken offline that waits on the phone and sends when the connection returns.
 * Photos are a generated 1x1 PNG that the app re-encodes to a JPEG. Practice
 * session; rows removed afterwards.
 */
const SLUG = uniqueSlug("e2e-flow");
const STARTED = new Date(Date.now() - 1000);
const STAMP = Date.now().toString(36).toUpperCase();
const TAG_1 = `E2E-${STAMP}-0001`;
const TAG_2 = `E2E-${STAMP}-0002`;
let sw: TestSession;
const ids: Record<string, string> = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG);
  for (const name of ["Pip", "Bella", "Max"]) {
    ids[name] = (await manualAdd(admin.request, sw.id, { stuffy: name, snack: name === "Bella" ? "Apple slices" : "Cookie", careNote: name === "Bella" ? "Loves a hug" : undefined })).id;
  }
  await admin.close();
});

test.afterAll(async () => {
  await cleanupSession(SLUG, STARTED);
});

async function openStuffy(page: Page, name: string) {
  await page.getByRole("button", { name: "Stuffies" }).click();
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

async function typeSticker(page: Page, code: string) {
  await page.getByLabel("Or type the code printed on the sticker").fill(code);
  await page.getByRole("button", { name: "Go", exact: true }).click();
}

test("the roster shows the registered stuffies and no parent contact data anywhere", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  for (const name of ["Pip", "Bella", "Max"]) await expect(page.getByRole("button", { name: new RegExp(`^${name}`) }).first()).toBeVisible();
  const html = await page.content();
  for (const secret of ["example.invalid", "555-0100", "Testa", "Parent"]) expect(html).not.toContain(secret);
  // Search works on the stuffy name.
  await page.getByLabel("Find a stuffy").fill("bel");
  await expect(page.getByRole("button", { name: /^Bella/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pip/ })).toHaveCount(0);
  await page.getByLabel("Find a stuffy").fill("zzzz");
  await expect(page.getByText("Not finding it? Ask the event chair.")).toBeVisible();
  await context.close();
});

test("bind a sticker by typing it, then move it with a confirmation", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);

  await openStuffy(page, "Pip");
  // The tag card shows the family so the worker can greet them; the roster never did.
  await expect(page.getByText("Testa Parent")).toBeVisible();
  await typeSticker(page, TAG_1);
  await expect(page.getByText(/Sticker ready, ending 0001/)).toBeVisible();
  await page.getByRole("button", { name: "Put this sticker on Pip" }).click();
  await expect(page.getByText("Sticker ending 0001")).toBeVisible();
  await expect(page.getByText("Snack choice")).toBeVisible();

  // The same sticker on another stuffy: the worker is asked, and cancelling changes nothing.
  await openStuffy(page, "Bella");
  await typeSticker(page, TAG_1);
  await page.getByRole("button", { name: "Put this sticker on Bella" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Pip");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await db.select().from(swStuffies).where(eq(swStuffies.id, ids.Pip)))[0].state).toBe("tagged");

  await page.getByRole("button", { name: "Put this sticker on Bella" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move it" }).click();
  await expect(page.getByText("Sticker ending 0001")).toBeVisible();
  const [pip] = await db.select().from(swStuffies).where(eq(swStuffies.id, ids.Pip));
  const [bella] = await db.select().from(swStuffies).where(eq(swStuffies.id, ids.Bella));
  expect(pip.state).toBe("registered");
  expect(pip.tagCode).toBeNull();
  expect(bella.state).toBe("tagged");
  expect(bella.tagCode).toBe(TAG_1);
  await context.close();
});

test("change a sticker on a tagged stuffy: replace confirmation, new last four on the roster; a stale card is refused in plain words", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await openStuffy(page, "Bella");
  await expect(page.getByText("Sticker ending 0001")).toBeVisible();
  await page.getByRole("button", { name: "Change sticker" }).click();
  await typeSticker(page, `E2E-${STAMP}-0099`);
  await page.getByRole("button", { name: "Put this sticker on Bella" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("0001");
  await dialog.getByRole("button", { name: "Replace it" }).click();
  await page.getByRole("button", { name: "Stuffies" }).click();
  await expect(page.getByRole("button", { name: /^Bella[\s\S]*Sticker ending 0099/ }).first()).toBeVisible();
  const [bella] = await db.select().from(swStuffies).where(eq(swStuffies.id, ids.Bella));
  expect(bella.tagCode).toBe(`E2E-${STAMP}-0099`);

  // A stale card: the sticker changes behind the phone's back, then the worker tries to change it.
  await openStuffy(page, "Bella");
  await db.update(swStuffies).set({ tagCode: `E2E-${STAMP}-7777` }).where(eq(swStuffies.id, ids.Bella));
  await page.getByRole("button", { name: "Change sticker" }).click();
  await typeSticker(page, `E2E-${STAMP}-0055`);
  await page.getByRole("button", { name: "Put this sticker on Bella" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Someone else just changed this stuffy" })).toBeVisible();
  await context.close();
});

test("check in with a photo: saved on the phone first, the state advances when the server answers", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await openStuffy(page, "Bella");
  // Snack choice and care note are shown at check-in.
  await expect(page.getByText("Apple slices")).toBeVisible();
  await expect(page.getByText("Loves a hug")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(PNG_FILE);
  await expect(page.getByText("For: Bella")).toBeVisible();
  await page.getByRole("button", { name: "Use photo" }).click();
  await expectRowState(page, "Bella", "Checked in");
  const photos = await db.select().from(swPhotos).where(and(eq(swPhotos.stuffyId, ids.Bella), eq(swPhotos.kind, "check_in")));
  expect(photos).toHaveLength(1);
  expect(photos[0].contentType).toBe("image/jpeg");
  await context.close();
});

test("check in without a photo is allowed and asks first", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await openStuffy(page, "Pip");
  await typeSticker(page, TAG_2);
  await page.getByRole("button", { name: "Put this sticker on Pip" }).click();
  await expect(page.getByRole("button", { name: "Check in without a photo" })).toBeVisible();
  await page.getByRole("button", { name: "Check in without a photo" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Check in" }).click();
  // The card moves on to the next step by itself: the portrait.
  await expect(page.getByRole("heading", { name: "Portrait with Santa" })).toBeVisible();
  await expect(page.getByText("Checked in without a photo")).toBeVisible();
  await page.getByRole("button", { name: "Stuffies" }).click();
  await expectRowState(page, "Pip", "Checked in");
  const photos = await db.select().from(swPhotos).where(eq(swPhotos.stuffyId, ids.Pip));
  expect(photos).toHaveLength(0);
  await context.close();
});

test("portrait, then a retake leaves exactly one current portrait", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);

  await openStuffy(page, "Bella");
  await expect(page.getByText(/Keep the sticker out of the shot/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(PNG_FILE);
  await page.getByRole("button", { name: "Use photo" }).click();
  await expectRowState(page, "Bella", "Portrait done");

  // A stuffy with a portrait opens on the hand-over; a retake is one tap away.
  await openStuffy(page, "Bella");
  // The check-in photo is on the pickup card and loads from the photo door.
  const [checkIn] = await db.select().from(swPhotos).where(and(eq(swPhotos.stuffyId, ids.Bella), eq(swPhotos.kind, "check_in")));
  const doorSrc = `/api/santas-workshop/photos/${checkIn.id}?v=full`;
  const pickupImg = page.locator(`img[src="${doorSrc}"]`);
  await expect(pickupImg).toBeVisible();
  await expect.poll(() => pickupImg.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Confirm who is collecting" })).toBeVisible();
  await page.getByRole("button", { name: "Retake the portrait" }).click();
  const thumb = page.getByAltText("Current portrait of Bella");
  await expect(thumb).toBeVisible();
  // ...and on the portrait card.
  const portraitImg = page.locator(`img[src="${doorSrc}"]`);
  await expect(portraitImg).toBeVisible();
  await expect.poll(() => portraitImg.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.locator('input[type="file"]').setInputFiles(PNG_FILE);
  await page.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Replace the portrait?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Replace it" }).click();
  await expect(page.getByRole("button", { name: /^Bella/ }).first()).toBeVisible();
  await expect
    .poll(async () => (await db.select().from(swPhotos).where(and(eq(swPhotos.stuffyId, ids.Bella), eq(swPhotos.kind, "portrait")))).length, { timeout: 25_000 })
    .toBe(2);
  const current = await db.select().from(swPhotos).where(and(eq(swPhotos.stuffyId, ids.Bella), eq(swPhotos.kind, "portrait"), isNull(swPhotos.supersededAt)));
  expect(current).toHaveLength(1);
  await context.close();
});

test("pickup: name shown first, then a recorded choice, then pickup; a second stuffy with someone else; a second tap says already picked up", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  const base = `/api/santas-workshop/crew/${SLUG}/stuffies/${ids.Bella}`;

  // Before the reveal the server refuses the check and the pickup, and nothing it said holds the parent's name.
  const bodies: string[] = [];
  const checkEarly = await page.request.post(`${base}/pickup-check`, { data: { result: "matched", idempotencyKey: crypto.randomUUID() } });
  bodies.push(await checkEarly.text());
  expect(checkEarly.status()).toBe(409);
  expect(JSON.parse(bodies[0]).code).toBe("name_not_shown");
  const early = await page.request.post(`${base}/pickup`, { data: { expectedState: "portrait_taken", idempotencyKey: crypto.randomUUID() } });
  bodies.push(await early.text());
  expect(early.status()).toBe(409);
  expect(JSON.parse(bodies[1]).code).toBe("pickup_check_required");
  bodies.push(await (await page.request.get(`/api/santas-workshop/crew/${SLUG}/roster`)).text());
  bodies.push(await (await page.request.get(`${base}?view=pickup`)).text());
  for (const b of bodies) expect(b).not.toContain("Parent");

  await openStuffy(page, "Bella");
  await expect(page.getByRole("button", { name: "Mark picked up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Name matches" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show the name on the order" }).click();
  await expect(page.getByText("Testa Parent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark picked up" })).toBeDisabled();
  await page.getByRole("button", { name: "Name matches" }).click();
  await expect(page.getByText("Recorded: the name matches.")).toBeVisible();
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("Bella is picked up.")).toBeVisible();
  await expect(page.getByAltText("QR code for the family's photo page")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expectRowState(page, "Bella", "Picked up");

  // Someone else is collecting: a note is required, then pickup is allowed.
  await openStuffy(page, "Pip");
  await page.getByRole("button", { name: "Hand over without a portrait" }).click();
  await page.getByRole("button", { name: "Show the name on the order" }).click();
  await page.getByRole("button", { name: "Someone else is collecting" }).click();
  await page.getByRole("button", { name: "Save, then I can mark it picked up" }).click();
  await expect(page.getByText(/who is collecting/i).first()).toBeVisible();
  await page.getByLabel("Who is collecting?").fill("Grandpa Joe");
  await page.getByRole("button", { name: "Save, then I can mark it picked up" }).click();
  await expect(page.getByText("Noted: Grandpa Joe")).toBeVisible();
  await page.getByRole("button", { name: "Mark picked up" }).click();
  await expect(page.getByText("Pip is picked up.")).toBeVisible();

  const again = await page.request.post(`${base}/pickup`, { data: { expectedState: "portrait_taken", idempotencyKey: crypto.randomUUID() } });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe("already_picked_up");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await openStuffy(page, "Bella");
  await expect(page.getByText(/already been picked up/)).toBeVisible();
  await context.close();
});

test("a group photo is filed against the session, not a stuffy", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await page.getByRole("button", { name: "Group photo" }).click();
  await page.locator('input[type="file"]').setInputFiles(PNG_FILE);
  await page.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByText(/1 group photo saved on this phone/)).toBeVisible();
  await expect
    .poll(async () => (await db.select().from(swPhotos).where(and(eq(swPhotos.sessionId, sw.id), eq(swPhotos.kind, "group")))).length, { timeout: 25_000 })
    .toBe(1);
  await context.close();
});

test("scan screen: an unbound sticker offers Tag it now and Find by name", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await page.getByRole("button", { name: "Scan", exact: true }).click();

  // A bound sticker opens its stuffy on the step it is on.
  await typeSticker(page, TAG_2);
  await expect(page.getByRole("heading", { level: 2, name: "Pip" })).toBeVisible();

  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await typeSticker(page, `E2E-${STAMP}-UNBOUND`);
  await expect(page.getByText("This sticker isn't on a stuffy yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find by name" })).toBeVisible();
  await page.getByRole("button", { name: "Tag it now" }).click();
  await expect(page.getByText(/Tap the stuffy it belongs to/)).toBeVisible();
  await page.getByRole("button", { name: /^Max/ }).first().click();
  await expect(page.getByText(/Sticker ready, ending OUND/)).toBeVisible();
  await page.getByRole("button", { name: "Put this sticker on Max" }).click();
  await expect(page.getByText("Sticker ending OUND")).toBeVisible();
  await context.close();
});

test("a photo taken with no connection waits on the phone and sends when the connection returns", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await openStuffy(page, "Max");
  await page.locator('input[type="file"]').setInputFiles(PNG_FILE);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByText(/1 photo waiting to send/)).toBeVisible();
  await expect(page.getByText(/exist only on this phone/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/photo waiting to send/)).toHaveCount(0, { timeout: 30_000 });
  await expectRowState(page, "Max", "Checked in");
  await context.close();
});

test("practice sessions let a worker go back a step; the row returns to the earlier step", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await openStuffy(page, "Max");
  await page.getByRole("button", { name: /Go back a step/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Go back" }).click();
  // The card drops back to the step it is now on: the check-in.
  await expect(page.getByRole("heading", { name: "Check-in photo" })).toBeVisible();
  await page.getByRole("button", { name: "Stuffies" }).click();
  await expectRowState(page, "Max", "Tagged");
  await context.close();
});
