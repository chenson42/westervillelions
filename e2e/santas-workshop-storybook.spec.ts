import { mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { test, expect, request as pwRequest, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swPhotos, swSessions } from "../src/lib/db/schema";
import { getPhotoStore } from "../src/lib/santas-workshop/photo-store";
import { selectPhotoStoreMode } from "../src/lib/santas-workshop/photo-store/config";
import { adminPage, cleanupSession, collageToken, createPracticeSession, seedPhoto, seedStuffy, uniqueSlug, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop storybook (Slice C, B-211): `/santas-workshop/c/<token>/book`, a print-styled
 * page over the collage's approved view that families save as a PDF from the browser's print
 * dialog. Three practice sessions: one with a storyline (live), one with no scenes, one purged.
 * Fake text only; every row and stored file is removed in afterAll. Set QA_SHOTS=<dir> to also
 * write the rendered PDF and screenshots there.
 */
const SLUG = uniqueSlug("e2e-book");
const SLUG_EMPTY = uniqueSlug("e2e-book-z");
const SLUG_GONE = uniqueSlug("e2e-book-g");
const STARTED = new Date(Date.now() - 1000);
const SHOTS = process.env.QA_SHOTS;
let sw: TestSession;
let empty: TestSession;
let gone: TestSession;
let token = "";
const scenes: Record<string, string> = {};
/** Photo ids by role. */
const ph: { s1: string[]; s2: string[]; s3: string; hiddenS4: string; other: string; portrait: string; late: string } = { s1: [], s2: [], s3: "", hiddenS4: "", other: "", portrait: "", late: "" };

const TITLES = ["Santa arrives", "Cookies and cocoa", "Mrs. Claus waves", "Hidden only", "No photos at all"];
const UUID_RE = /\/api\/santas-workshop\/photos\/([0-9a-f-]{36})/;

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A decodable PNG with a dark 14 px border, so a clipped edge in the printed page is visible. */
function framedPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const edge = x < 14 || y < 14 || x >= width - 14 || y >= height - 14;
      const c = edge ? [0, 20, 60] : rgb;
      row[1 + x * 3] = c[0];
      row[2 + x * 3] = c[1];
      row[3 + x * 3] = c[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

let colour = 0;
/** A real group photo (bytes in the photo store, row in sw_photos) assigned to a scene. */
async function seedGroup(s: TestSession, sceneId: string | null, w = 1200, h = 900): Promise<string> {
  const store = getPhotoStore();
  const folder = await store.ensureFolder(s.slug);
  await db.update(swSessions).set({ storageFolderKey: folder }).where(eq(swSessions.id, s.id));
  const id = crypto.randomUUID();
  colour += 1;
  const bytes = framedPng(w, h, [(colour * 53) % 200 + 40, (colour * 97) % 200 + 40, (colour * 151) % 200 + 40]);
  const full = await store.put({ folderKey: folder, photoId: id, variant: "full", bytes, contentType: "image/jpeg" });
  const thumb = await store.put({ folderKey: folder, photoId: id, variant: "thumb", bytes, contentType: "image/jpeg" });
  await db.insert(swPhotos).values({
    id, sessionId: s.id, stuffyId: null, sceneId, kind: "group", storageKind: selectPhotoStoreMode(), storageKey: full.key, thumbStorageKey: thumb.key,
    contentType: "image/jpeg", byteSize: bytes.length, thumbByteSize: bytes.length, width: w, height: h, takenAt: new Date(),
  });
  return id;
}

async function addScene(admin: Page, s: TestSession, title: string, caption: string | null): Promise<string> {
  const res = await admin.request.post(`/api/admin/santas-workshop/sessions/${s.id}/scenes`, { data: { title, caption } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).scene.id as string;
}

async function reviewAndPublish(admin: Page, s: TestSession) {
  await admin.goto(`/admin/santas-workshop/${s.id}/photos`);
  await admin.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(admin.getByRole("button", { name: "Mark group photos reviewed" })).toBeDisabled();
  await admin.getByRole("button", { name: "Publish the collage" }).click();
  await expect(admin.getByText("Published", { exact: true })).toBeVisible();
}

/** Photo ids in the order a page shows them inside the given section selector. */
async function idsIn(page: Page, selector: string): Promise<string[]> {
  const srcs = await page.locator(`${selector} img`).evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute("src") ?? ""));
  return srcs.map((s) => UUID_RE.exec(s)?.[1] ?? "").filter(Boolean);
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(SHOTS ?? ".", { recursive: true });
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG, true);
  empty = await createPracticeSession(admin.request, SLUG_EMPTY, true);
  gone = await createPracticeSession(admin.request, SLUG_GONE, true);
  token = await collageToken(sw.id);
  scenes[TITLES[0]] = await addScene(admin, sw, TITLES[0], "The sleigh lands on the lawn.");
  scenes[TITLES[1]] = await addScene(admin, sw, TITLES[1], null);
  scenes[TITLES[2]] = await addScene(admin, sw, TITLES[2], "A wave from the porch.");
  scenes[TITLES[3]] = await addScene(admin, sw, TITLES[3], null);
  scenes[TITLES[4]] = await addScene(admin, sw, TITLES[4], null);
  // Scene 1: eight pictures, the last one upright, to exercise pagination and a tall frame.
  for (let i = 0; i < 7; i += 1) ph.s1.push(await seedGroup(sw, scenes[TITLES[0]]));
  ph.s1.push(await seedGroup(sw, scenes[TITLES[0]], 900, 1200));
  for (let i = 0; i < 3; i += 1) ph.s2.push(await seedGroup(sw, scenes[TITLES[1]]));
  ph.s3 = await seedGroup(sw, scenes[TITLES[2]]);
  ph.hiddenS4 = await seedGroup(sw, scenes[TITLES[3]]);
  ph.other = await seedGroup(sw, null);
  const stuffy = await seedStuffy(admin.request, sw.id, "Fuzzy Bear", true);
  ph.portrait = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: stuffy, rgb: [200, 40, 40], takenAt: new Date() });
  // The empty-storyline session: one group picture, no scenes.
  await seedGroup(empty, null);
  await seedGroup(gone, null);
  const goneScene = await addScene(admin, gone, "Gone scene", null);
  const goneHidden = await seedGroup(gone, goneScene);
  expect((await admin.request.post(`/api/admin/santas-workshop/photos/${goneHidden}/hide`, { data: { hidden: true } })).status()).toBe(200);
  await admin.close();
});

test.afterAll(async () => {
  for (const s of [SLUG, SLUG_EMPTY, SLUG_GONE]) await cleanupSession(s, STARTED);
});

test("pending: no storybook link on the collage, and /book answers with a redirect that carries no scene text", async ({ browser }) => {
  const anon = await pwRequest.newContext();
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const collage = await (await anon.get(`${base}/santas-workshop/c/${token}`)).text();
  expect(collage).not.toContain("Download the storybook");
  for (const t of TITLES) expect(collage, `pending collage leak: ${t}`).not.toContain(t);
  const book = await anon.get(`${base}/santas-workshop/c/${token}/book`, { maxRedirects: 0 });
  console.log("pending /book:", book.status(), book.headers().location);
  expect([307, 308]).toContain(book.status());
  expect(book.headers().location).toContain(`/santas-workshop/c/${token}`);
  const body = await book.text();
  for (const t of TITLES) expect(body, `pending book leak: ${t}`).not.toContain(t);
  await anon.dispose();

  // Followed to the end, the visitor lands on the collage's pending state.
  const page = await browser.newPage();
  await page.goto(`/santas-workshop/c/${token}/book`);
  expect(new URL(page.url()).pathname).toBe(`/santas-workshop/c/${token}`);
  await page.close();
});

test("publish: hide two pictures first, review, publish", async ({ browser }) => {
  const admin = await adminPage(browser);
  for (const id of [ph.s2[2], ph.hiddenS4]) {
    const res = await admin.request.post(`/api/admin/santas-workshop/photos/${id}/hide`, { data: { hidden: true } });
    expect(res.status(), await res.text()).toBe(200);
  }
  await reviewAndPublish(admin, sw);
  await admin.close();
});

test("live: the collage offers the storybook, and /book is cover + one page per scene with pictures + closing, group pictures only, no names", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`/santas-workshop/c/${token}`);
  const link = page.getByRole("link", { name: /Download the storybook/ });
  await expect(link).toHaveCount(1);
  expect(await link.getAttribute("href")).toBe(`/santas-workshop/c/${token}/book`);
  const collageScenes = [await idsIn(page, 'section[aria-labelledby="scene-0-heading"]'), await idsIn(page, 'section[aria-labelledby="scene-1-heading"]'), await idsIn(page, 'section[aria-labelledby="scene-2-heading"]')];
  const collageOther = await idsIn(page, 'section[aria-labelledby="group-heading"]');
  console.log("collage scene sizes:", collageScenes.map((s) => s.length), "other:", collageOther.length);
  expect(collageScenes.map((s) => s.length)).toEqual([8, 2, 1]);

  await link.click();
  await page.waitForURL(`**/book`);
  const sections = page.locator("main > section");
  // cover + 3 scenes + closing
  await expect(sections).toHaveCount(5);
  const headings = await page.locator("main h1, main h2").allInnerTexts();
  console.log("book headings:", JSON.stringify(headings));
  expect(headings.slice(1)).toEqual(["Santa arrives", "Cookies and cocoa", "Mrs. Claus waves"]);
  for (const t of ["Hidden only", "No photos at all", "Other pictures", "Fuzzy Bear"]) await expect(page.locator("body")).not.toContainText(t);
  await expect(page.getByText("The sleigh lands on the lawn.")).toBeVisible();

  // Exactly the collage's scene pictures, same order, full variant; nothing else (no portrait, no unscened).
  const bookScenes = await page.locator('[data-testid="book-scene"]').evaluateAll((uls) => uls.map((ul) => Array.from(ul.querySelectorAll("img")).map((i) => i.getAttribute("src") ?? "")));
  expect(bookScenes.map((s) => s.length)).toEqual([8, 2, 1]);
  const bookIds = bookScenes.map((s) => s.map((x) => UUID_RE.exec(x)?.[1] ?? ""));
  expect(bookIds).toEqual(collageScenes);
  for (const s of bookScenes.flat()) expect(s).toContain("v=full");
  const all = bookIds.flat();
  for (const forbidden of [ph.portrait, ph.other, ph.hiddenS4, ph.s2[2]]) expect(all).not.toContain(forbidden);

  // Alt text is ordinal, unique, and carries no names.
  const alts = await page.locator("main img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt));
  console.log("book alts:", JSON.stringify(alts));
  expect(new Set(alts).size).toBe(alts.length);
  expect(alts.join(" ")).not.toMatch(/fuzzy|bear|stuffy named/i);

  // Closing page text.
  await expect(sections.nth(4)).toContainText("A copy you save stays on your device.");
  await expect(sections.nth(4)).toContainText("take it down");
  // The token is not in any visible text (it is only in the link/back hrefs).
  expect(await page.locator("body").innerText()).not.toContain(token);
  await page.close();
});

test("unknown and malformed tokens: /book answers the same 404 as the collage", async () => {
  const anon = await pwRequest.newContext();
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const unknown = "0".repeat(32);
  for (const t of [unknown, "not-a-token"]) {
    const c = await anon.get(`${base}/santas-workshop/c/${t}`);
    const b = await anon.get(`${base}/santas-workshop/c/${t}/book`);
    console.log(`token ${t}: collage ${c.status()} book ${b.status()}`);
    expect(c.status()).toBe(404);
    expect(b.status()).toBe(404);
    // Dev mode embeds a stack trace naming the page component in a <template>; it is not part of the visible 404.
    const strip = (h: string) => h.replace(/<template[\s\S]*?<\/template>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ");
    const cb = strip(await c.text());
    const bb = strip(await b.text());
    console.log(`  404 documents identical (stack trace removed): ${cb === bb}; title: ${/<title>([^<]*)/.exec(bb)?.[1]}`);
    expect(bb).toBe(cb);
    expect(bb.includes(t)).toBe(false);
  }
  await anon.dispose();
});

test("hiding a live picture removes it from the book exactly as from the collage; a late upload stays out of both until Publish late photos", async ({ browser }) => {
  const admin = await adminPage(browser);
  const pub = await browser.newPage();
  const bookIds = async () => {
    await pub.goto(`/santas-workshop/c/${token}/book`);
    return pub.locator('[data-testid="book-scene"]').evaluateAll((uls) => uls.map((ul) => Array.from(ul.querySelectorAll("img")).map((i) => /photos\/([0-9a-f-]{36})/.exec(i.getAttribute("src") ?? "")?.[1] ?? "")));
  };
  const collageIds = async () => {
    await pub.goto(`/santas-workshop/c/${token}`);
    return [await idsIn(pub, 'section[aria-labelledby="scene-0-heading"]'), await idsIn(pub, 'section[aria-labelledby="scene-1-heading"]'), await idsIn(pub, 'section[aria-labelledby="scene-2-heading"]')];
  };

  // Hide one more picture in scene 1.
  expect((await admin.request.post(`/api/admin/santas-workshop/photos/${ph.s1[0]}/hide`, { data: { hidden: true } })).status()).toBe(200);
  let b = await bookIds();
  let c = await collageIds();
  expect(b.map((s) => s.length)).toEqual([7, 2, 1]);
  expect(b).toEqual(c);
  expect(b.flat()).not.toContain(ph.s1[0]);
  expect((await admin.request.post(`/api/admin/santas-workshop/photos/${ph.s1[0]}/hide`, { data: { hidden: false } })).status()).toBe(200);

  // Hiding the only visible picture of a scene removes its page.
  expect((await admin.request.post(`/api/admin/santas-workshop/photos/${ph.s3}/hide`, { data: { hidden: true } })).status()).toBe(200);
  await pub.goto(`/santas-workshop/c/${token}/book`);
  await expect(pub.locator("main > section")).toHaveCount(4);
  await expect(pub.getByRole("heading", { name: "Mrs. Claus waves" })).toHaveCount(0);
  expect((await admin.request.post(`/api/admin/santas-workshop/photos/${ph.s3}/hide`, { data: { hidden: false } })).status()).toBe(200);

  // A picture uploaded after the publish is private on both surfaces.
  ph.late = await seedGroup(sw, scenes[TITLES[0]]);
  b = await bookIds();
  c = await collageIds();
  expect(b.map((s) => s.length)).toEqual([8, 2, 1]);
  expect(b.flat()).not.toContain(ph.late);
  expect(c.flat()).not.toContain(ph.late);
  expect(b).toEqual(c);
  const stranger = await pwRequest.newContext();
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  expect((await stranger.get(`${base}/api/santas-workshop/photos/${ph.late}?v=full`)).status()).toBe(404);

  // Review it and Publish late photos: now on both.
  await admin.goto(`/admin/santas-workshop/${sw.id}/photos`);
  await admin.getByRole("button", { name: "Mark group photos reviewed" }).click();
  await expect(admin.locator(`[data-photo-id="${ph.late}"]`)).not.toContainText("Not reviewed yet");
  await admin.getByRole("button", { name: "Publish late photos" }).click();
  await expect(admin.locator(`[data-photo-id="${ph.late}"]`)).toContainText("Visible to anyone with the link");
  b = await bookIds();
  c = await collageIds();
  expect(b.map((s) => s.length)).toEqual([9, 2, 1]);
  expect(b).toEqual(c);
  expect(b[0]).toContain(ph.late);
  await stranger.dispose();
  await pub.close();
  await admin.close();
});

test("print: Letter PDF is cover + one page per scene + a closing page, and the 8-picture scene paginates without clipping", async ({ browser }) => {
  // Drop the late picture again so the long scene is the 8-picture one (hide is a normal admin action).
  const admin = await adminPage(browser);
  expect((await admin.request.post(`/api/admin/santas-workshop/photos/${ph.late}/hide`, { data: { hidden: true } })).status()).toBe(200);
  await admin.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`/santas-workshop/c/${token}/book`);
  const pictures = '[data-testid="book-scene"] img';
  await page.waitForFunction((sel) => Array.from(document.querySelectorAll<HTMLImageElement>(sel)).every((i) => i.complete && i.naturalWidth > 0), pictures);
  const others = await page.evaluate((sel) => Array.from(document.images).filter((i) => !i.matches(sel)).map((i) => `${i.getAttribute("src")?.slice(0, 80)} complete=${i.complete} w=${i.naturalWidth}`), pictures);
  console.log("non-book images on the page:", JSON.stringify(others));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/book-screen.png`, fullPage: true });
  await page.emulateMedia({ media: "print" });
  const pdfPath = SHOTS ? `${SHOTS}/storybook.pdf` : undefined;
  const pdf = await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true, path: pdfPath });
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log("PDF bytes:", pdf.length, "pages:", pages);
  // cover (1) + scene 1 (8 pictures: 2 pages expected) + scene 2 (1) + scene 3 (1) + closing (1)
  expect(pages).toBeGreaterThanOrEqual(5);
  expect(pages).toBeLessThanOrEqual(6);
  // No print control leaks into the printed page.
  await expect(page.locator(".sw-noprint").first()).toBeHidden();
  await page.close();
});

test("360 px phone: the book does not scroll sideways, and Save as PDF and the iPhone hint are visible", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await page.goto(`/santas-workshop/c/${token}/book`);
  await expect(page.getByRole("button", { name: "Save as PDF" })).toBeVisible();
  await expect(page.getByText(/On an iPhone or iPad/)).toBeVisible();
  await expect(page.getByText(/loads all the pictures/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/book-360-top.png` });
    await page.screenshot({ path: `${SHOTS}/book-360-full.png`, fullPage: true });
  }
  await page.close();
});

test("book headers: noindex, nofollow and no-referrer on the response and in the document", async ({ browser }) => {
  const anon = await pwRequest.newContext();
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const book = await anon.get(`${base}/santas-workshop/c/${token}/book`, { maxRedirects: 0 });
  expect(book.status(), "the live book itself, not a redirect").toBe(200);
  const collage = await anon.get(`${base}/santas-workshop/c/${token}`);
  const pick = (r: typeof book) => ({ robots: r.headers()["x-robots-tag"] ?? null, referrer: r.headers()["referrer-policy"] ?? null, cache: r.headers()["cache-control"] ?? null });
  console.log("collage headers:", JSON.stringify(pick(collage)), "book headers:", JSON.stringify(pick(book)));
  const html = await book.text();
  const robotsMeta = /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? null;
  const referrerMeta = /<meta name="referrer" content="([^"]*)"/.exec(html)?.[1] ?? null;
  console.log("book meta robots:", robotsMeta, "| meta referrer:", referrerMeta);
  // Document-level posture (the page's own metadata).
  expect(robotsMeta).toMatch(/noindex/);
  expect(robotsMeta).toMatch(/nofollow/);
  expect(referrerMeta).toBe("no-referrer");
  // Response-level posture, as the collage has it.
  expect(pick(book).robots, "X-Robots-Tag on /book").toMatch(/noindex/);
  expect(pick(book).referrer, "Referrer-Policy on /book").toBe("no-referrer");
  await anon.dispose();
});

test("no scenes: the collage has no storybook link and /book redirects to it", async ({ browser }) => {
  const admin = await adminPage(browser);
  await reviewAndPublish(admin, empty);
  await admin.close();
  const t = await collageToken(empty.id);
  const page = await browser.newPage();
  await page.goto(`/santas-workshop/c/${t}`);
  await expect(page.getByTestId("collage-group")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /storybook/i })).toHaveCount(0);
  await page.goto(`/santas-workshop/c/${t}/book`);
  expect(new URL(page.url()).pathname).toBe(`/santas-workshop/c/${t}`);
  await page.close();
});

test("scenes exist but none has a visible group picture: no link, /book redirects", async ({ browser }) => {
  // The 'gone' session holds a scene whose only picture is hidden, and one unscened visible picture.
  const admin = await adminPage(browser);
  await reviewAndPublish(admin, gone);
  await admin.close();
  const t = await collageToken(gone.id);
  const page = await browser.newPage();
  await page.goto(`/santas-workshop/c/${t}`);
  await expect(page.getByRole("link", { name: /storybook/i })).toHaveCount(0);
  await page.goto(`/santas-workshop/c/${t}/book`);
  expect(new URL(page.url()).pathname).toBe(`/santas-workshop/c/${t}`);
  await page.close();
});

test("removed: after a public purge the collage has no link and /book answers the removed page with no scene text", async ({ browser }) => {
  await db.update(swSessions).set({ publicPurgedAt: new Date() }).where(eq(swSessions.id, sw.id));
  const page = await browser.newPage();
  await page.goto(`/santas-workshop/c/${token}`);
  await expect(page.getByRole("heading", { name: "These photos have been removed" })).toBeVisible();
  await expect(page.getByRole("link", { name: /storybook/i })).toHaveCount(0);
  const res = await page.goto(`/santas-workshop/c/${token}/book`);
  console.log("removed /book final:", new URL(page.url()).pathname, res?.status());
  expect(new URL(page.url()).pathname).toBe(`/santas-workshop/c/${token}`);
  const html = await page.content();
  for (const t of TITLES.slice(0, 3)) expect(html, `removed leak: ${t}`).not.toContain(t);
  await expect(page.locator('img[src*="/api/santas-workshop/photos/"]')).toHaveCount(0);
  await page.close();
});

test("privacy page carries the saved-copy sentence", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("A copy you save stays on your device.")).toBeVisible();
});
