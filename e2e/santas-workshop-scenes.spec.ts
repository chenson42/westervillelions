import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swPhotos, swScenes, swSessions } from "../src/lib/db/schema";
import { makeJpeg } from "../src/lib/santas-workshop/photo-fixtures";
import { PNG_FILE, adminPage, cleanupSession, collageToken, createPracticeSession, crewContext, enterCode, uniqueSlug, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop group-photo scenes (DECISION-128), end to end: the admin Storyline card,
 * the server's treatment of a scene id on the real crew upload route (unknown, foreign and
 * deleted ids are indistinguishable), the phone's scene picker, the admin photos page
 * ("Move to scene"), and the public collage as a storyline. Two practice sessions; fake text
 * only; every row and stored file is removed in afterAll.
 */
const SLUG = uniqueSlug("e2e-scn");
const SLUG_OTHER = uniqueSlug("e2e-scn-x");
const SLUG_EMPTY = uniqueSlug("e2e-scn-z");
const STARTED = new Date(Date.now() - 1000);
let sw: TestSession;
let other: TestSession;
let empty: TestSession;
const scenes: Record<string, string> = {};
const photos: Record<string, string> = {};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

test.beforeAll(async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG, true);
  other = await createPracticeSession(admin.request, SLUG_OTHER, true);
  empty = await createPracticeSession(admin.request, SLUG_EMPTY, true);
  await admin.close();
});

test.afterAll(async () => {
  for (const s of [SLUG, SLUG_OTHER, SLUG_EMPTY]) await cleanupSession(s, STARTED);
});

/** The real crew route, reached with the admin cookie (requireCrew accepts a santas_workshop.manage holder). */
async function uploadGroup(request: APIRequestContext, slug: string, sceneId?: unknown, photoId: string = crypto.randomUUID()) {
  const jpeg = Buffer.from(makeJpeg(160, 120));
  const meta: Record<string, unknown> = { photoId, takenAt: new Date().toISOString(), width: 160, height: 120, thumbWidth: 160, thumbHeight: 120 };
  if (sceneId !== undefined) meta.sceneId = sceneId;
  const res = await request.post(`/api/santas-workshop/crew/${slug}/group-photos`, {
    multipart: { meta: JSON.stringify(meta), full: { name: "full.jpg", mimeType: "image/jpeg", buffer: jpeg }, thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: jpeg } },
  });
  return { photoId, status: res.status(), text: await res.text() };
}

async function sceneOf(photoId: string): Promise<string | null> {
  const [row] = await db.select({ s: swPhotos.sceneId }).from(swPhotos).where(eq(swPhotos.id, photoId));
  return row ? row.s : "MISSING";
}

test("admin Storyline card: warning, field errors, add, edit, reorder, delete with a confirmation", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}`);
  const card = page.getByRole("region", { name: "Storyline scenes" });
  await expect(card.getByText("No scenes yet.")).toBeVisible();

  await card.getByRole("button", { name: "Add a scene" }).click();
  await expect(card.getByRole("note")).toContainText("This text is public. Do not use the names of children, families or stuffies.");

  // Field-level errors come from the server's reject sentence.
  await card.getByLabel("Title").fill("Call 614 555 0100");
  await card.getByRole("button", { name: "Add scene" }).click();
  await expect(card.locator("#scene-title-error")).toContainText("Remove the phone number");
  await card.getByLabel("Title").fill("Santa arrives");
  await card.getByLabel("Caption (optional)").fill("Write to us at someone@example.com");
  await card.getByRole("button", { name: "Add scene" }).click();
  await expect(card.locator("#scene-caption-error")).toContainText("Remove the email address");
  await card.getByLabel("Caption (optional)").fill("The sleigh lands on the lawn.");
  await expect(card.getByText("29 of 280 characters")).toBeVisible();
  await card.getByRole("button", { name: "Add scene" }).click();
  await expect(card.getByTestId("scenes-list").getByText("Santa arrives")).toBeVisible();

  for (const t of ["Mrs. Claus waves", "Cookies and cocoa"]) {
    await card.getByRole("button", { name: "Add a scene" }).click();
    await card.getByLabel("Title").fill(t);
    await card.getByRole("button", { name: "Add scene" }).click();
    await expect(card.getByTestId("scenes-list").getByText(t)).toBeVisible();
  }
  const titles = () => card.getByTestId("scenes-list").locator("li p.font-semibold").allInnerTexts();
  expect((await titles()).map((t) => t.replace(/^\d+\.\s*/, ""))).toEqual(["Santa arrives", "Mrs. Claus waves", "Cookies and cocoa"]);

  // The first Up and last Down are disabled; moving the last scene up reorders.
  await expect(card.getByRole("button", { name: "Move Santa arrives up" })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Move Cookies and cocoa down" })).toBeDisabled();
  await card.getByRole("button", { name: "Move Cookies and cocoa up" }).click();
  await expect.poll(async () => (await titles()).map((t) => t.replace(/^\d+\.\s*/, ""))).toEqual(["Santa arrives", "Cookies and cocoa", "Mrs. Claus waves"]);
  await page.reload();
  expect((await page.getByRole("region", { name: "Storyline scenes" }).getByTestId("scenes-list").locator("li p.font-semibold").allInnerTexts()).map((t) => t.replace(/^\d+\.\s*/, ""))).toEqual(["Santa arrives", "Cookies and cocoa", "Mrs. Claus waves"]);

  // Edit.
  const card2 = page.getByRole("region", { name: "Storyline scenes" });
  await card2.getByRole("listitem").filter({ hasText: "Cookies and cocoa" }).getByRole("button", { name: "Edit" }).click();
  await card2.getByLabel("Title").fill("Cookies, cocoa and carols");
  await card2.getByRole("button", { name: "Save scene" }).click();
  await expect(card2.getByTestId("scenes-list").getByText("Cookies, cocoa and carols")).toBeVisible();

  // Delete: cancel changes nothing, confirm removes.
  await card2.getByRole("listitem").filter({ hasText: "Mrs. Claus waves" }).getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete this scene?");
  await expect(dialog).toContainText("No photos are in this scene.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(card2.getByTestId("scenes-list").getByText("Mrs. Claus waves")).toBeVisible();
  await card2.getByRole("listitem").filter({ hasText: "Mrs. Claus waves" }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete scene" }).click();
  await expect(card2.getByTestId("scenes-list").getByText("Mrs. Claus waves")).toHaveCount(0);

  const rows = await db.select().from(swScenes).where(eq(swScenes.sessionId, sw.id));
  for (const r of rows) scenes[r.title] = r.id;
  expect(rows.map((r) => r.title).sort()).toEqual(["Cookies, cocoa and carols", "Santa arrives"]);
  await page.close();
});

test("scene limits: 60/280 code points, 20 scenes, and the API gates", async ({ browser }) => {
  const admin = await adminPage(browser);
  const post = (data: unknown) => admin.request.post(`/api/admin/santas-workshop/sessions/${other.id}/scenes`, { data });
  expect((await post({ title: "a".repeat(60), caption: "b".repeat(280) })).status()).toBe(201);
  const long = await post({ title: "a".repeat(61), caption: null });
  expect(long.status()).toBe(400);
  expect((await long.json()).field).toBe("title");
  expect((await post({ title: "ok", caption: "c".repeat(281) })).status()).toBe(400);
  // 60 emoji are 60 code points (120 UTF-16 units): accepted; 61 rejected.
  expect((await post({ title: "🎄".repeat(60), caption: null })).status()).toBe(201);
  expect((await post({ title: "🎄".repeat(61), caption: null })).status()).toBe(400);
  expect((await post({ title: "   ", caption: null })).status()).toBe(400);
  for (const bad of ["see westervillelions.org", "http://x.example", "me@example.com", "1234567", "Call 614-555-0100"]) {
    expect((await post({ title: bad, caption: null })).status(), bad).toBe(400);
  }
  expect((await post({ title: "Dec 18-20, 2026", caption: null })).status()).toBe(201);
  // 3 created above; fill to 20, the 21st is refused.
  for (let i = 4; i <= 20; i += 1) expect((await post({ title: `Scene ${i}`, caption: null })).status()).toBe(201);
  const over = await post({ title: "One too many", caption: null });
  expect(over.status()).toBe(409);
  expect((await over.json()).code).toBe("scene_limit");

  // The card says so at the limit and disables Add.
  await admin.goto(`/admin/santas-workshop/${other.id}`);
  await expect(admin.getByText("A session can have 20 scenes.")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Add a scene" })).toBeDisabled();
  await admin.close();

  // Anonymous and crew-cookie-only callers cannot use the admin scene routes.
  const anon = await pwRequest.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000" });
  for (const [m, path] of [
    ["get", `/api/admin/santas-workshop/sessions/${sw.id}/scenes`],
    ["post", `/api/admin/santas-workshop/sessions/${sw.id}/scenes`],
    ["put", `/api/admin/santas-workshop/sessions/${sw.id}/scenes/order`],
    ["delete", `/api/admin/santas-workshop/sessions/${sw.id}/scenes/${scenes["Santa arrives"]}`],
    ["put", `/api/admin/santas-workshop/photos/${crypto.randomUUID()}/scene`],
  ] as const) {
    const res = await anon[m](path, { data: m === "get" || m === "delete" ? undefined : { title: "x", caption: null, order: [], sceneId: null } });
    expect([401, 403], `${m} ${path}`).toContain(res.status());
  }
  const crewScenes = await anon.get(`/api/santas-workshop/crew/${SLUG}/scenes`);
  expect(crewScenes.status()).toBe(401);
  await anon.dispose();
});

test("L1: unknown, foreign, deleted and malformed scene ids are indistinguishable on the upload route; only a real scene is stored", async ({ browser }) => {
  const admin = await adminPage(browser);
  const [foreign] = await db.select().from(swScenes).where(eq(swScenes.sessionId, other.id)).limit(1);
  const [tmp] = await db.insert(swScenes).values({ sessionId: sw.id, title: "Doomed", caption: null, position: 99 }).returning({ id: swScenes.id });
  await db.delete(swScenes).where(eq(swScenes.id, tmp.id));

  const variants: [string, unknown][] = [
    ["valid", scenes["Santa arrives"]],
    ["foreign", foreign.id],
    ["deleted", tmp.id],
    ["random uuid", crypto.randomUUID()],
    ["garbage", "not-a-uuid"],
    ["number", 7],
    ["object", { a: 1 }],
    ["absent", undefined],
  ];
  const sigs = new Set<string>();
  const stored: Record<string, string | null> = {};
  for (const [name, v] of variants) {
    const r = await uploadGroup(admin.request, SLUG, v);
    const body = JSON.parse(r.text) as { ok: boolean; replayed: boolean; photoId: string };
    sigs.add(`${r.status} ${JSON.stringify({ ...body, photoId: "<id>" })}`);
    expect(body).not.toHaveProperty("sceneId");
    stored[name] = await sceneOf(r.photoId);
    if (name === "valid") photos.santa = r.photoId;
  }
  console.log("L1 distinct response signatures:", sigs.size, [...sigs]);
  console.log("L1 stored scene per variant:", JSON.stringify(stored));
  expect(sigs.size).toBe(1);
  expect(stored.valid).toBe(scenes["Santa arrives"]);
  for (const [name] of variants.filter(([n]) => n !== "valid")) expect(stored[name], name).toBeNull();

  // A replay of the same photo id keeps the first scene.
  const replay = await uploadGroup(admin.request, SLUG, scenes["Cookies, cocoa and carols"], photos.santa);
  expect(replay.status).toBe(200);
  expect(await sceneOf(photos.santa)).toBe(scenes["Santa arrives"]);
  await admin.close();
});

test("L2: 20 uploads racing the delete of their scene all succeed; none is lost and the leftovers fall to no scene", async ({ browser }) => {
  const admin = await adminPage(browser);
  const created = await admin.request.post(`/api/admin/santas-workshop/sessions/${empty.id}/scenes`, { data: { title: "Race", caption: null } });
  const raceId = (await created.json()).scene.id as string;
  const ids = Array.from({ length: 20 }, () => crypto.randomUUID());
  let deleteMs = 0;
  const uploads = ids.map((id, i) => (async () => {
    await new Promise((r) => setTimeout(r, i * 25));
    return uploadGroup(admin.request, SLUG_EMPTY, raceId, id);
  })());
  const del = (async () => {
    await new Promise((r) => setTimeout(r, 200));
    const t = Date.now();
    const res = await admin.request.delete(`/api/admin/santas-workshop/sessions/${empty.id}/scenes/${raceId}`);
    deleteMs = Date.now() - t;
    return res;
  })();
  const [results, delRes] = await Promise.all([Promise.all(uploads), del]);
  const failed = results.filter((r) => r.status !== 200);
  const scenesAfter = await Promise.all(ids.map(sceneOf));
  const inScene = scenesAfter.filter((s) => s === raceId).length;
  const nulls = scenesAfter.filter((s) => s === null).length;
  console.log(`L2 delete status ${delRes.status()} in ${deleteMs} ms; failed uploads ${failed.length}; rows ${scenesAfter.filter((s) => s !== "MISSING").length}/20; null scene ${nulls}; still pointing at deleted scene ${inScene}`);
  expect(delRes.status()).toBe(200);
  expect(failed).toEqual([]);
  expect(scenesAfter.filter((s) => s === "MISSING")).toEqual([]);
  expect(inScene).toBe(0);
  expect(nulls).toBe(20);
  await admin.close();
});

test("L5: name-shaped scene titles are accepted (the warning and preview are the control), contact-shaped ones are rejected", async ({ browser }) => {
  const admin = await adminPage(browser);
  const url = `/api/admin/santas-workshop/sessions/${empty.id}/scenes`;
  const names = ["Emma's Sleigh Ride", "The Hendersons Visit Santa", "Liam meets Rudolph", "Olivia and Sparkle", "Noah's Big Moment", "Ava the Brave", "Mason Smith at the Sleigh", "Sophia's Cookies", "Ethan and Mr. Buttons", "Mia Johnson Waves"];
  let accepted = 0;
  for (const n of names) {
    const r = await admin.request.post(url, { data: { title: n, caption: null } });
    if (r.status() === 201) {
      accepted += 1;
      await admin.request.delete(`/api/admin/santas-workshop/sessions/${empty.id}/scenes/${(await r.json()).scene.id}`);
    }
  }
  const contact = ["mom@example.com", "call 614.555.0100", "https://example.com/x", "visit example.org", "(614) 555-0100", "email me at a@b.co", "1234567890", "www.example.com", "text 614 555 0199", "x@y.invalid"];
  let rejected = 0;
  for (const c of contact) {
    const r = await admin.request.post(url, { data: { title: "Fine title", caption: c } });
    if (r.status() === 400) rejected += 1;
    else await admin.request.delete(`/api/admin/santas-workshop/sessions/${empty.id}/scenes/${(await r.json()).scene.id}`);
  }
  console.log(`L5 name-shaped accepted ${accepted}/10; contact-shaped rejected ${rejected}/10`);
  expect(accepted).toBe(10);
  expect(rejected).toBe(10);
  await admin.close();
});

test("phone (360 px): the picker, sticky choice, disabled capture until chosen, For: pill, scene and Other uploads, saved photo", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await page.getByRole("button", { name: "Group photo" }).click();
  const take = page.locator('input[type="file"][capture]');
  const saved = page.locator('input[type="file"]:not([capture])');
  await expect(page.getByText("Pick a scene first.")).toBeVisible();
  await expect(take).toBeDisabled();
  await expect(saved).toBeDisabled();
  await expect(page.getByRole("radio")).toHaveCount(3); // two scenes + Other
  // 360 px: nothing scrolls sideways and each option is at least 44px tall.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const box of await page.getByRole("radio").all()) expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Scene upload.
  await page.getByRole("radio", { name: /Santa arrives/ }).click();
  await expect(take).toBeEnabled();
  await expect(saved).toBeEnabled();
  await take.setInputFiles(PNG_FILE);
  await expect(page.getByText("For: Santa arrives")).toBeVisible();
  await page.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByText(/1 group photo saved on this phone/)).toBeVisible();
  // The choice is sticky after a save.
  await expect(page.getByRole("radio", { name: /Santa arrives/ })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await db.select().from(swPhotos).where(and(eq(swPhotos.sessionId, sw.id), eq(swPhotos.sceneId, scenes["Santa arrives"])))).length, { timeout: 25_000 }).toBe(2); // L1's valid + this one

  // Choose a saved photo still works, in another scene.
  await page.getByRole("radio", { name: /Cookies, cocoa and carols/ }).click();
  await saved.setInputFiles(PNG_FILE);
  await expect(page.getByText("For: Cookies, cocoa and carols")).toBeVisible();
  await page.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByText(/2 group photos saved on this phone/)).toBeVisible();
  await expect.poll(async () => (await db.select().from(swPhotos).where(and(eq(swPhotos.sessionId, sw.id), eq(swPhotos.sceneId, scenes["Cookies, cocoa and carols"])))).length, { timeout: 25_000 }).toBe(1);

  // Other: no scene.
  const noSceneBefore = (await db.select().from(swPhotos).where(and(eq(swPhotos.sessionId, sw.id), isNull(swPhotos.sceneId)))).length;
  await page.getByRole("radio", { name: /Other/ }).click();
  await take.setInputFiles(PNG_FILE);
  await expect(page.getByText("For: Other")).toHaveCount(0); // no pill for Other
  await page.getByRole("button", { name: "Use photo" }).click();
  await expect(page.getByText(/3 group photos saved on this phone/)).toBeVisible();
  await expect.poll(async () => (await db.select().from(swPhotos).where(and(eq(swPhotos.sessionId, sw.id), isNull(swPhotos.sceneId)))).length, { timeout: 25_000 }).toBe(noSceneBefore + 1);
  await page.screenshot({ path: process.env.QA_SHOTS ? `${process.env.QA_SHOTS}/phone-picker.png` : undefined });

  // Reload: the sticky choice survives.
  await page.reload();
  await page.getByRole("button", { name: "Group photo" }).click();
  await expect(page.getByRole("radio", { name: /Other/ })).toHaveAttribute("aria-checked", "true");
  await context.close();
});

test("phone with a scene list that cannot load and no cache: capture stays enabled and says the photo goes in unscened", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await page.route("**/api/santas-workshop/crew/*/scenes", (route) => route.abort());
  await page.getByRole("button", { name: "Group photo" }).click();
  await expect(page.getByText("Scenes didn't load. You can still take the photo; an admin will put it in a scene.")).toBeVisible();
  await expect(page.locator('input[type="file"][capture]')).toBeEnabled();
  await context.close();
});

test("a zero-scene session's phone panel has no picker and capture is enabled", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG_EMPTY, empty.code);
  await page.getByRole("button", { name: "Group photo" }).click();
  await expect(page.locator('input[type="file"][capture]')).toBeEnabled();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText("Which scene is this photo for?")).toHaveCount(0);
  await context.close();
});

test("admin photos page: scene chips, Move to scene, a scene deleted elsewhere says so; then publish and read the collage", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/photos`);
  const tile = page.locator(`[data-photo-id="${photos.santa}"]`);
  await expect(tile).toContainText("Scene: Santa arrives");
  // Move a scene photo to the other scene, then to Other pictures.
  await tile.getByLabel("Move to scene").selectOption({ label: "Cookies, cocoa and carols" });
  await expect(tile).toContainText("Scene: Cookies, cocoa and carols");
  await tile.getByLabel("Move to scene").selectOption({ label: "Santa arrives" });
  await expect(tile).toContainText("Scene: Santa arrives");

  // scene_gone: a scene deleted behind this tab's back.
  const [ghost] = await db.insert(swScenes).values({ sessionId: sw.id, title: "Ghost scene", caption: null, position: 50 }).returning({ id: swScenes.id });
  await page.reload();
  await expect(tile.getByLabel("Move to scene").locator("option", { hasText: "Ghost scene" })).toHaveCount(1);
  await db.delete(swScenes).where(eq(swScenes.id, ghost.id));
  await tile.getByLabel("Move to scene").selectOption({ label: "Ghost scene" });
  await expect(page.getByText("That scene no longer exists.")).toBeVisible();
  await expect(tile.getByLabel("Move to scene").locator("option", { hasText: "Ghost scene" })).toHaveCount(0);
  expect(await sceneOf(photos.santa)).toBe(scenes["Santa arrives"]);

  // Before publishing, the collage carries no scene text.
  const token = await collageToken(sw.id);
  const pending = await (await page.request.get(`/santas-workshop/c/${token}`)).text();
  for (const t of ["Santa arrives", "Cookies, cocoa and carols"]) expect(pending, `pending leak: ${t}`).not.toContain(t);

  await page.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(page.getByRole("button", { name: "Mark group photos reviewed" })).toBeDisabled();
  await page.getByRole("button", { name: "Publish the collage" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  const pub = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await pub.goto(`/santas-workshop/c/${token}`);
  const headings = await pub.locator("main h2, h2").allInnerTexts();
  console.log("collage headings:", JSON.stringify(headings));
  expect(headings.indexOf("Santa arrives")).toBeGreaterThanOrEqual(0);
  expect(headings.indexOf("Santa arrives")).toBeLessThan(headings.indexOf("Cookies, cocoa and carols"));
  expect(headings.indexOf("Cookies, cocoa and carols")).toBeLessThan(headings.indexOf("Other pictures"));
  await expect(pub.getByText("The sleigh lands on the lawn.")).toBeVisible();
  await expect(pub.getByTestId("collage-scene")).toHaveCount(2);
  await expect(pub.getByTestId("collage-group")).toHaveCount(1);
  expect(await pub.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await pub.screenshot({ path: process.env.QA_SHOTS ? `${process.env.QA_SHOTS}/collage-storyline.png` : undefined, fullPage: true });

  // L3: every tile id on the page is served by the photo door to an anonymous fetch.
  const srcs = await pub.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).currentSrc || (e as HTMLImageElement).src));
  const anon = await pwRequest.newContext();
  let mismatches = 0;
  for (const s of srcs.filter((s) => s.includes("/api/"))) if ((await anon.get(s)).status() !== 200) mismatches += 1;
  console.log(`L3 images on page ${srcs.length}; door mismatches ${mismatches}`);
  expect(mismatches).toBe(0);
  await anon.dispose();

  // A scene whose only photos are hidden is absent; hide it back and forth.
  const cookiePhoto = (await db.select().from(swPhotos).where(and(eq(swPhotos.sessionId, sw.id), eq(swPhotos.sceneId, scenes["Cookies, cocoa and carols"]))))[0];
  const hide = await page.request.post(`/api/admin/santas-workshop/photos/${cookiePhoto.id}/hide`, { data: { hidden: true } });
  expect(hide.status(), await hide.text()).toBe(200);
  await pub.reload();
  await expect(pub.getByRole("heading", { name: "Cookies, cocoa and carols" })).toHaveCount(0);
  await expect(pub.getByRole("heading", { name: "Santa arrives" })).toBeVisible();
  await page.request.post(`/api/admin/santas-workshop/photos/${cookiePhoto.id}/hide`, { data: { hidden: false } });

  await pub.close();
  await page.close();
});

test("scene text is shown as plain text, never as markup", async ({ browser }) => {
  const admin = await adminPage(browser);
  const res = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/scenes`, { data: { title: "<b>Bold</b> & <script>1</script>", caption: "<img src=x onerror=alert(1)>" } });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).scene.id as string;
  const late = await uploadGroup(admin.request, SLUG, id);
  const token = await collageToken(sw.id);
  // The session is already published, so this photo is a late one: review it, then Publish late photos.
  await admin.goto(`/admin/santas-workshop/${sw.id}/photos`);
  await admin.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(admin.getByRole("button", { name: "Mark group photos reviewed" })).toBeDisabled();
  await admin.getByRole("button", { name: "Publish late photos" }).click();
  await expect(admin.locator(`[data-photo-id="${late.photoId}"]`)).toContainText("Visible to anyone with the link");
  const page = await browser.newPage();
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "<b>Bold</b> & <script>1</script>" })).toBeVisible();
  await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
  expect(await page.locator("main b, main script, main img[onerror]").count()).toBe(0);
  await page.close();
  await admin.close();
});

test("a session with no scenes shows the collage exactly as before: one Group pictures grid", async ({ browser }) => {
  const admin = await adminPage(browser);
  await uploadGroup(admin.request, SLUG_EMPTY);
  await admin.goto(`/admin/santas-workshop/${empty.id}/photos`);
  await admin.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(admin.getByRole("button", { name: "Mark group photos reviewed" })).toBeDisabled();
  await admin.getByRole("button", { name: "Publish the collage" }).click();
  await expect(admin.getByText("Published", { exact: true })).toBeVisible();
  // The photos page offers no scene controls when the session has no scenes.
  await expect(admin.getByLabel("Move to scene")).toHaveCount(0);
  const page = await browser.newPage();
  await page.goto(`/santas-workshop/c/${await collageToken(empty.id)}`);
  await expect(page.getByRole("heading", { name: "Group pictures" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other pictures" })).toHaveCount(0);
  await expect(page.getByTestId("collage-group")).toHaveCount(1);
  await expect(page.getByTestId("collage-scene")).toHaveCount(0);
  await page.close();
  await admin.close();
});

test("deleting a scene with photos: the dialog names the count and the photos fall to Other pictures on the collage", async ({ browser }) => {
  const page = await adminPage(browser);
  const pub = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const token = await collageToken(sw.id);
  await page.goto(`/admin/santas-workshop/${sw.id}`);
  const card = page.getByRole("region", { name: "Storyline scenes" });
  const santaRow = card.getByRole("listitem").filter({ hasText: "Santa arrives" });
  const n = (await db.select().from(swPhotos).where(eq(swPhotos.sceneId, scenes["Santa arrives"]))).length;
  expect(n).toBeGreaterThan(0);
  // The list row and the dialog both state the real count.
  await expect(santaRow).toContainText(`${n} photo${n === 1 ? "" : "s"}`);
  await santaRow.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(`${n} photo${n === 1 ? " is" : "s are"} in this scene and will move to “Other pictures”.`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete scene" }).click();
  await expect(page.getByText(`Scene deleted. ${n} photo${n === 1 ? "" : "s"} moved to Other pictures.`)).toBeVisible();
  await expect(card.getByTestId("scenes-list").getByText("Santa arrives")).toHaveCount(0);
  expect((await db.select().from(swPhotos).where(eq(swPhotos.id, photos.santa)))[0].sceneId).toBeNull();
  await pub.goto(`/santas-workshop/c/${token}`);
  await expect(pub.getByRole("heading", { name: "Santa arrives" })).toHaveCount(0);
  await expect(pub.getByRole("heading", { name: "Other pictures" })).toBeVisible();
  await pub.close();
  await page.close();
});

test("rotating the worker code makes the phone forget the sticky scene (cold load shows the code screen)", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);
  await page.getByRole("button", { name: "Group photo" }).click();
  await page.getByRole("radio", { name: /Santa arrives|Cookies, cocoa and carols/ }).first().click();
  const admin = await adminPage(browser);
  const rot = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/crew-code`, { data: { action: "rotate", acknowledge: true } });
  expect(rot.status(), await rot.text()).toBe(200);
  sw.code = (await (await admin.request.get(`/api/admin/santas-workshop/sessions/${sw.id}/crew-code`)).json()).code;
  await admin.close();
  await page.reload();
  await expect(page.getByLabel("Worker code")).toBeVisible();
  await enterCode(page, SLUG, sw.code);
  await page.getByRole("button", { name: "Group photo" }).click();
  await expect(page.getByText("Pick a scene first.")).toBeVisible();
  await context.close();
});

test("removed: a publicly purged session prints no scene text; a practice reset keeps the scenes and drops the photos", async ({ browser }) => {
  const token = await collageToken(sw.id);
  const titles = (await db.select().from(swScenes).where(eq(swScenes.sessionId, sw.id))).map((s) => s.title);
  expect(titles.length).toBeGreaterThan(0);
  await db.update(swSessions).set({ publicPurgedAt: new Date() }).where(eq(swSessions.id, sw.id));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(`/santas-workshop/c/${token}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "These photos have been removed" })).toBeVisible();
  const html = await page.content();
  for (const t of titles) expect(html, `removed leak: ${t}`).not.toContain(t.replace(/&/g, "&amp;"));
  await expect(page.locator('img[src*="/api/santas-workshop/photos/"]')).toHaveCount(0);
  await ctx.close();

  // Reset (practice only): the photos go, the storyline stays.
  const admin = await adminPage(browser);
  const reset = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/reset`);
  expect(reset.status(), await reset.text()).toBe(200);
  expect((await db.select().from(swPhotos).where(eq(swPhotos.sessionId, sw.id))).length).toBe(0);
  expect((await db.select().from(swScenes).where(eq(swScenes.sessionId, sw.id))).map((s) => s.title).sort()).toEqual([...titles].sort());
  await admin.close();
});
