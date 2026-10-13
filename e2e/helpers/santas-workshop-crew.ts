/**
 * Shared setup for the Santa's Workshop crew e2e specs: a practice session made
 * through the real admin API (signed-in admin), activated, with its worker code
 * read back, and a few manual registrants. Everything uses fake names and
 * example.invalid addresses, and `cleanupSession` removes every row by slug
 * (children cascade) plus the throttle rows these specs created.
 */
import { expect, type APIRequestContext, type BrowserContext, type Browser, type Page } from "@playwright/test";
import { and, eq, gte, like, or } from "drizzle-orm";
import { db } from "../../src/lib/db";
import { swCrewAttempts, swSessions } from "../../src/lib/db/schema";
import { getPhotoStore } from "../../src/lib/santas-workshop/photo-store";
import { selectPhotoStoreMode } from "../../src/lib/santas-workshop/photo-store/config";
import { makeJpeg } from "../../src/lib/santas-workshop/photo-fixtures";
import { signInAsAdmin } from "./auth";

/** A real 1x1 PNG. The crew app re-encodes whatever it is given to a JPEG, which is what the server accepts. */
export const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const PNG_FILE = { name: "photo.png", mimeType: "image/png", buffer: PNG_1X1 };

export const WINDOW = { id: "w1", label: "5:00 PM – 6:00 PM", start: "17:00", end: "18:00" };

export interface TestSession {
  id: string;
  slug: string;
  code: string;
  formatted: string;
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

/** A documentation-range address, different per spec run, so the throttle of one spec never blocks another. */
export function fakeIp(): string {
  const n = () => 1 + Math.floor(Math.random() * 250);
  return `198.51.${n()}.${n()}`;
}

export async function createPracticeSession(request: APIRequestContext, slug: string, activate = true): Promise<TestSession> {
  const created = await request.post("/api/admin/santas-workshop/sessions", {
    data: {
      name: `E2E crew ${slug}`,
      slug,
      kind: "practice",
      dropoffDate: "2026-12-18",
      photoDate: "2026-12-19",
      pickupDate: "2026-12-20",
      windows: [WINDOW],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).session.id as string;
  if (activate) await setStatus(request, id, "active");
  const code = await request.get(`/api/admin/santas-workshop/sessions/${id}/crew-code`);
  const body = (await code.json()) as { code: string | null; formatted: string | null };
  return { id, slug, code: body.code ?? "", formatted: body.formatted ?? "" };
}

export async function setStatus(request: APIRequestContext, id: string, to: "draft" | "active" | "closed") {
  const res = await request.post(`/api/admin/santas-workshop/sessions/${id}/status`, { data: { to } });
  expect(res.status(), await res.text()).toBe(200);
}

export async function manualAdd(
  request: APIRequestContext,
  sessionId: string,
  input: { stuffy: string; parentFirst?: string; parentLast?: string; snack?: string; careNote?: string },
) {
  const res = await request.post(`/api/admin/santas-workshop/sessions/${sessionId}/stuffies`, {
    data: {
      parentFirstName: input.parentFirst ?? "Testa",
      parentLastName: input.parentLast ?? "Parent",
      stuffyName: input.stuffy,
      windowId: WINDOW.id,
      reason: "end-to-end test",
      idempotencyKey: crypto.randomUUID(),
      snack: input.snack ?? "Cookie",
      careNote: input.careNote,
      parentEmail: "parent@example.invalid",
      parentPhone: "555-0100",
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).registrant as { id: string; orderId: string };
}

/** A browser context with NO admin cookie, as a volunteer's phone has, behind its own fake IP. */
export async function crewContext(browser: Browser, ip: string = fakeIp()): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip }, viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  return { context, page };
}

export async function enterCode(page: Page, slug: string, code: string) {
  await page.goto(`/santas-workshop/crew/${slug}`);
  await page.getByLabel("Worker code").fill(code);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E crew");
}

export async function adminPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await signInAsAdmin(page);
  return page;
}

/** Deletes every file the session stored, through the same adapter the dev server used (local mode only: never touches Drive). */
async function removeStoredPhotos(slug: string) {
  if (selectPhotoStoreMode() !== "local") return;
  const [row] = await db.select({ folder: swSessions.storageFolderKey }).from(swSessions).where(eq(swSessions.slug, slug)).limit(1);
  if (!row?.folder) return;
  const store = getPhotoStore();
  let token: string | undefined;
  do {
    const page = await store.list(row.folder, token);
    for (const item of page.items) await store.delete(item.key);
    token = page.next;
  } while (token);
}

export async function cleanupSession(slug: string, since: Date) {
  await removeStoredPhotos(slug).catch(() => undefined); // best effort: a missing folder is fine
  await db.delete(swSessions).where(eq(swSessions.slug, slug));
  // Throttle rows are keyed by hash, not by session slug; remove the ones this run created.
  await db.delete(swCrewAttempts).where(and(gte(swCrewAttempts.createdAt, since), or(like(swCrewAttempts.scopeKey, "ip:%"), like(swCrewAttempts.scopeKey, "sess:%"))));
}

/** Waits for the row of a stuffy in the crew list to show a state label. */
export async function expectRowState(page: Page, stuffy: string, label: string) {
  await expect(page.getByRole("button", { name: new RegExp(`${stuffy}[\\s\\S]*${label}`) }).first()).toBeVisible({ timeout: 25_000 });
}

// ---------------------------------------------------------------------------
// Collage specs: photos seeded straight through the photo store and the table
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import { swPhotos, swStuffies } from "../../src/lib/db/schema";

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

/** A real, decodable solid-colour PNG (the browser sniffs images, so the door's JPEG label does not matter here). */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A stuffy created through the real manual-add route, with its consent flag set directly. */
export async function seedStuffy(request: APIRequestContext, sessionId: string, name: string, consent: boolean): Promise<string> {
  const r = await manualAdd(request, sessionId, { stuffy: name });
  await db.update(swStuffies).set({ photoConsent: consent }).where(eq(swStuffies.id, r.id));
  return r.id;
}

/** Puts a photo in the store and its row in sw_photos. Group photos pass stuffyId null. */
export async function seedPhoto(
  sessionId: string,
  slug: string,
  input: { kind: "group" | "portrait"; stuffyId: string | null; rgb: [number, number, number]; takenAt: Date },
): Promise<string> {
  const store = getPhotoStore();
  const folder = await store.ensureFolder(slug);
  await db.update(swSessions).set({ storageFolderKey: folder }).where(eq(swSessions.id, sessionId));
  const id = crypto.randomUUID();
  const w = input.kind === "group" ? 160 : 120;
  const h = input.kind === "group" ? 120 : 160;
  const bytes = solidPng(w, h, input.rgb);
  const full = await store.put({ folderKey: folder, photoId: id, variant: "full", bytes, contentType: "image/jpeg" });
  const thumb = await store.put({ folderKey: folder, photoId: id, variant: "thumb", bytes, contentType: "image/jpeg" });
  await db.insert(swPhotos).values({
    id,
    sessionId,
    stuffyId: input.stuffyId,
    kind: input.kind,
    storageKind: selectPhotoStoreMode(),
    storageKey: full.key,
    thumbStorageKey: thumb.key,
    contentType: "image/jpeg",
    byteSize: bytes.length,
    thumbByteSize: bytes.length,
    width: w,
    height: h,
    takenAt: input.takenAt,
  });
  return id;
}

export async function collageToken(sessionId: string): Promise<string> {
  const [row] = await db.select({ t: swSessions.collageToken }).from(swSessions).where(eq(swSessions.id, sessionId)).limit(1);
  return row.t;
}

/**
 * Uploads a group photo through the REAL crew route (the signed-in admin is accepted by requireCrew),
 * so `created_at` is the database's own microsecond `now()` and not a JavaScript Date seeded by a
 * helper. This is the path that exposed S3-D1; do not replace it with `seedPhoto`.
 */
export async function uploadGroupPhoto(request: APIRequestContext, slug: string, takenAt: Date = new Date()): Promise<string> {
  const photoId = crypto.randomUUID();
  const jpeg = Buffer.from(makeJpeg(160, 120));
  const res = await request.post(`/api/santas-workshop/crew/${slug}/group-photos`, {
    multipart: {
      meta: JSON.stringify({ photoId, takenAt: takenAt.toISOString(), width: 160, height: 120, thumbWidth: 160, thumbHeight: 120 }),
      full: { name: "full.jpg", mimeType: "image/jpeg", buffer: jpeg },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: jpeg },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return photoId;
}
