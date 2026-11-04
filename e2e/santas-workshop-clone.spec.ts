import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import { db } from "../src/lib/db";
import { swOrders, swPhotos, swScenes, swSessionLog, swSessions, swStuffies } from "../src/lib/db/schema";
import { defaultSessionDraft } from "../src/lib/santas-workshop/session-input";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Santa's Workshop "Clone session" (2026-11-04-session-clone, Phase 3 live checks 5-1 to 5-5).
 * A clone is the New session form pre-filled from a source; the server copies the settings the form
 * does not collect and leaves every credential and run identifier fresh.
 *
 * Dev server: PORT=3100 pnpm dev  (any port but 3000)
 * Runner:     PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm test:e2e e2e/santas-workshop-clone.spec.ts
 * Practice and example.invalid data only; every session this spec creates has the slug prefix below and is
 * deleted afterwards. No Zeffy call, no email.
 */

const STAMP = Date.now();
const PREFIX = `e2e-clone-${STAMP}`;
const MB = 1024 * 1024;
const map = JSON.parse(
  readFileSync(join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "question-map-practice.json"), "utf8"),
) as Record<string, string[]>;

test.describe.configure({ mode: "serial" });

const ids: Record<string, string> = {};

async function create(request: APIRequestContext, slug: string, kind: "practice" | "real") {
  const draft = defaultSessionDraft(kind);
  const res = await request.post("/api/admin/santas-workshop/sessions", { data: { ...draft, slug } });
  expect(res.status()).toBe(201);
  return (await res.json()).session.id as string;
}

const row = async (id: string) => (await db.select().from(swSessions).where(eq(swSessions.id, id)))[0];

test.afterAll(async () => {
  await db.delete(swSessions).where(like(swSessions.slug, `${PREFIX}%`));
});

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function fillClone(page: Page, opts: { name: string; slug: string; kind?: "Practice" | "Real"; pickup?: string }) {
  if (opts.kind) await page.getByRole("radio", { name: new RegExp(opts.kind) }).check();
  await page.getByLabel("Session name").fill(opts.name);
  await page.getByLabel("Short name for web addresses").fill(opts.slug);
  if (opts.pickup) await page.getByLabel("Pickup day").fill(opts.pickup);
}

test("setup: a practice source with every run-specific field populated, a worker code rotated and paused", async ({ page }) => {
  await signInAsAdmin(page);
  ids.src = await create(page.request, `${PREFIX}-src`, "practice");
  const src = await row(ids.src);
  await db
    .update(swSessions)
    .set({
      storageQuotaBytes: 250 * MB,
      frameFilePrefix: "oldprefix",
      framePartSize: 50,
      questionMap: map,
      crewClosesOn: "2027-01-05",
      purgePersonalOn: "2027-03-01",
      purgePublicOn: "2027-04-15",
      zeffyCampaignId: `${PREFIX}-campaign`,
      zeffyCampaignTitle: "E2E source form",
      zeffyTicketRateIds: ["rate-x"],
      storageFolderKey: `${PREFIX}-folder`,
      collagePublishedAt: new Date(),
    })
    .where(eq(swSessions.id, ids.src));

  const activate = await page.request.post(`/api/admin/santas-workshop/sessions/${ids.src}/status`, { data: { to: "active" } });
  expect(activate.status()).toBe(200);
  for (let i = 0; i < 2; i++) {
    const rotate = await page.request.post(`/api/admin/santas-workshop/sessions/${ids.src}/crew-code`, { data: { action: "rotate", acknowledge: true } });
    expect(rotate.status()).toBe(200);
  }
  const pause = await page.request.post(`/api/admin/santas-workshop/sessions/${ids.src}/crew-code`, { data: { action: "pause" } });
  expect(pause.status()).toBe(200);

  const after = await row(ids.src);
  expect(after.status).toBe("active");
  expect(after.crewCodeEnc).toBeTruthy();
  expect(after.crewCodeVersion).toBeGreaterThan(1);
  expect(after.crewPaused).toBe(true);
  expect(after.crewClosesOn).toBe("2027-01-05");
  expect(src.dropoffDate).toBe(after.dropoffDate);
});

test("the session page offers Clone session and the form opens pre-filled on Practice with a read-only storage line", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/${ids.src}`);
  await page.getByRole("link", { name: "Clone session" }).click();
  await page.waitForURL(new RegExp(`/admin/santas-workshop/new\\?cloneFrom=${ids.src}$`));

  await expect(page.getByRole("heading", { name: "Clone session" })).toBeVisible();
  await expect(page.getByText(/Dates, drop-off windows and question mapping are copied\. The Zeffy form, worker code and photos are not\./)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Practice/ })).toBeChecked();
  await expect(page.getByLabel("Session name")).toHaveValue("Santa's Workshop dry run");
  const src = await row(ids.src);
  await expect(page.getByLabel("Drop-off day")).toHaveValue(src.dropoffDate);
  await expect(page.getByLabel("Photo day")).toHaveValue(src.photoDate);
  await expect(page.getByLabel("Pickup day")).toHaveValue(src.pickupDate);
  for (const [i, w] of src.windows.entries()) await expect(page.locator(`#sw-w-label-${i}`)).toHaveValue(w.label);
  expect((await page.getByLabel("Short name for web addresses").inputValue()).length).toBeGreaterThanOrEqual(3);
  expect(await page.getByLabel("Short name for web addresses").inputValue()).not.toBe(src.slug);

  const quota = page.getByTestId("clone-quota-line");
  await expect(quota).toHaveText(/Photo storage limit: 250 MB\s+\(from the source\)/);
  await page.getByRole("radio", { name: /Real/ }).check();
  await expect(quota).toHaveText(/Photo storage limit: 600 MB\s+\(the default for a Real session\)/);
  await page.getByRole("radio", { name: /Practice/ }).check();
  await expect(quota).toHaveText(/250 MB\s+\(from the source\)/);
  // The quota is a line of text, not an input: nothing to type into.
  await expect(page.locator("input[name*='quota' i], input[id*='quota' i]")).toHaveCount(0);

  // Dates are in the future today (2026-11-04): no warning.
  await expect(page.getByText("This date has already passed.")).toHaveCount(0);
  await page.screenshot({ path: process.env.QA_SHOT_DIR ? join(process.env.QA_SHOT_DIR, "clone-form.png") : undefined, fullPage: true });
});

test("a source whose dates are in the past shows a warning on each stale date and does not block submit", async ({ page }) => {
  await signInAsAdmin(page);
  ids.past = await create(page.request, `${PREFIX}-past`, "practice");
  await db
    .update(swSessions)
    .set({ dropoffDate: "2025-01-10", photoDate: "2025-01-11", pickupDate: "2025-01-12", crewClosesOn: "2025-01-13", purgePersonalOn: "2025-02-11", purgePublicOn: "2026-01-31" })
    .where(eq(swSessions.id, ids.past));
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.past}`);
  await expect(page.getByText("This date has already passed.")).toHaveCount(3);

  // Warning, not a refusal: submit with the stale dates still creates a draft.
  await fillClone(page, { name: "E2E stale dates", slug: `${PREFIX}-stale` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/admin\/santas-workshop\/[0-9a-f-]{36}\/connect\?cloned=1$/);
  const made = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-stale`)))[0];
  expect(made.status).toBe("draft");
  // Pickup unchanged (2025-01-12) and the copied schedule is coherent: copied as is.
  expect(made.purgePublicOn).toBe("2026-01-31");
});

test("practice to real with a moved pickup day: fresh credentials, defaults for the schedule, the real quota, no prefix, the map copied (checks 5-1)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.src}`);
  const newPickup = "2026-12-22";
  await fillClone(page, { name: "E2E clone to real", slug: `${PREFIX}-real`, kind: "Real", pickup: newPickup });
  await page.getByRole("button", { name: "Create real session" }).click();

  // Lands on the new session's Connect page with the persistent hint.
  await page.waitForURL(/\/admin\/santas-workshop\/[0-9a-f-]{36}\/connect\?cloned=1$/);
  ids.real = page.url().match(/santas-workshop\/([0-9a-f-]{36})\//)![1];
  await expect(page.getByTestId("cloned-hint")).toContainText("Question mapping was copied from the source: make a test purchase and check Needs attention.");

  const src = await row(ids.src);
  const clone = await row(ids.real);
  // Fresh, credential-bearing and run-identifying fields: 0 of 9 copied.
  expect(clone.status).toBe("draft");
  expect(clone.crewCodeEnc).toBeNull();
  expect(clone.crewCodeVersion).toBe(1);
  expect(clone.crewPaused).toBe(false);
  expect(clone.collageToken).toBeTruthy();
  expect(clone.collageToken).not.toBe(src.collageToken);
  expect(clone.collagePublishedAt).toBeNull();
  expect(clone.zeffyCampaignId).toBeNull();
  expect(clone.zeffyCampaignTitle).toBeNull();
  expect(clone.zeffyTicketRateIds).toEqual([]);
  expect(clone.storageFolderKey).toBeNull();
  expect(clone.personalPurgedAt).toBeNull();
  expect(clone.publicPurgedAt).toBeNull();
  // Copied or derived configuration.
  expect(clone.kind).toBe("real");
  expect(clone.storageQuotaBytes).toBe(600 * MB);
  expect(clone.frameFilePrefix).toBe("");
  expect(clone.framePartSize).toBe(50);
  expect(clone.frameArtKey).toBe(src.frameArtKey);
  expect(clone.questionMap).toEqual(map);
  expect(clone.pickupDate).toBe(newPickup);
  expect(clone.crewClosesOn).toBe("2026-12-23"); // pickup + 1
  expect(clone.purgePersonalOn).toBe("2027-01-21"); // pickup + 30
  expect(clone.purgePublicOn).toBe("2027-01-31");
  expect(clone.windows).toEqual(src.windows);

  // No people, no pictures.
  expect(await db.select({ id: swOrders.id }).from(swOrders).where(eq(swOrders.sessionId, ids.real))).toHaveLength(0);
  expect(await db.select({ id: swStuffies.id }).from(swStuffies).where(eq(swStuffies.sessionId, ids.real))).toHaveLength(0);
  expect(await db.select({ id: swPhotos.id }).from(swPhotos).where(eq(swPhotos.sessionId, ids.real))).toHaveLength(0);

  // One audit row: ids only.
  const log = await db.select().from(swSessionLog).where(eq(swSessionLog.sessionId, ids.real));
  expect(log).toHaveLength(1);
  expect(log[0].kind).toBe("created");
  expect(log[0].detail).toEqual({ kind: "real", clonedFrom: ids.src });
  expect(JSON.stringify(log[0].detail)).not.toContain("E2E clone");

  // The source is untouched by the clone.
  const srcAfter = await row(ids.src);
  expect(srcAfter.crewCodeEnc).toBe(src.crewCodeEnc);
  expect(srcAfter.crewCodeVersion).toBe(src.crewCodeVersion);
  expect(srcAfter.collageToken).toBe(src.collageToken);
  expect(srcAfter.zeffyCampaignId).toBe(src.zeffyCampaignId);
});

test("practice to practice with the pickup day unchanged copies the schedule and the quota", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.src}`);
  await fillClone(page, { name: "E2E clone same pickup", slug: `${PREFIX}-same` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/connect\?cloned=1$/);
  const clone = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-same`)))[0];
  expect(clone.crewClosesOn).toBe("2027-01-05");
  expect(clone.purgePersonalOn).toBe("2027-03-01");
  expect(clone.purgePublicOn).toBe("2027-04-15");
  expect(clone.storageQuotaBytes).toBe(250 * MB);
  expect(clone.frameFilePrefix).toBe("");
  expect(clone.questionMap).toEqual(map);
  expect(clone.crewCodeEnc).toBeNull();
  expect(clone.crewCodeVersion).toBe(1);
  expect(clone.crewPaused).toBe(false);
  expect(clone.status).toBe("draft");
});

test("real to practice resets the quota to the practice default", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.real}`);
  // The form always opens on Practice, so a real-to-real clone needs a deliberate click.
  await expect(page.getByRole("radio", { name: /Practice/ })).toBeChecked();
  await expect(page.getByTestId("clone-quota-line")).toHaveText(/100 MB\s+\(the default for a Practice session\)/);
  await page.getByRole("radio", { name: /Real/ }).check();
  await expect(page.getByTestId("clone-quota-line")).toHaveText(/600 MB\s+\(from the source\)/);
  await page.getByRole("radio", { name: /Practice/ }).check();
  await fillClone(page, { name: "E2E real to practice", slug: `${PREFIX}-r2p` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/connect\?cloned=1$/);
  const clone = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-r2p`)))[0];
  expect(clone.kind).toBe("practice");
  expect(clone.storageQuotaBytes).toBe(100 * MB);
});

test("a taken slug keeps the form, shows the field error and creates nothing (409)", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.src}`);
  await fillClone(page, { name: "E2E collision", slug: `${PREFIX}-src` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await expect(page.getByText("That short name is already used by another session. Pick a different one.")).toBeVisible();
  expect(page.url()).toContain("/admin/santas-workshop/new?cloneFrom=");
  await expect(page.getByLabel("Session name")).toHaveValue("E2E collision");
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-src`))).toHaveLength(1);
});

test("two simultaneous clone submissions with one slug make exactly one session (check 5-4)", async ({ page }) => {
  await signInAsAdmin(page);
  const body = { ...defaultSessionDraft("practice"), name: "E2E double", slug: `${PREFIX}-dbl`, cloneFrom: ids.src };
  const [a, b] = await Promise.all([
    page.request.post("/api/admin/santas-workshop/sessions", { data: body }),
    page.request.post("/api/admin/santas-workshop/sessions", { data: body }),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([201, 409]);
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-dbl`))).toHaveLength(1);
  const created = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-dbl`)))[0];
  expect(await db.select({ id: swSessionLog.id }).from(swSessionLog).where(eq(swSessionLog.sessionId, created.id))).toHaveLength(1);
});

test("a malformed or unknown cloneFrom shows 'That session no longer exists' and never a blank form (check 5-5)", async ({ page }) => {
  await signInAsAdmin(page);
  for (const bad of ["not-a-uuid", "00000000-0000-4000-8000-000000000000", `${ids.src},${ids.src}`]) {
    await page.goto(`/admin/santas-workshop/new?cloneFrom=${bad}`);
    await expect(page.getByText("That session no longer exists")).toBeVisible();
    await expect(page.getByRole("button", { name: /Create (practice|real) session/ })).toHaveCount(0);
  }
  // The API refuses the same two shapes.
  const malformed = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-x1`, cloneFrom: "not-a-uuid" } });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).field ?? (await malformed.json()).error?.field).toBe("cloneFrom");
  const unknown = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-x2`, cloneFrom: "00000000-0000-4000-8000-000000000000" } });
  expect(unknown.status()).toBe(404);
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(inArray(swSessions.slug, [`${PREFIX}-x1`, `${PREFIX}-x2`]))).toHaveLength(0);
});

test("a closed and fully purged source clones with its configuration intact and no 500 (check 5-2)", async ({ page }) => {
  await signInAsAdmin(page);
  ids.purged = await create(page.request, `${PREFIX}-purged`, "practice");
  await db
    .update(swSessions)
    .set({ storageQuotaBytes: 300 * MB, framePartSize: 40, questionMap: map, status: "closed" })
    .where(eq(swSessions.id, ids.purged));
  for (const phase of ["personal", "public"]) {
    const res = await page.request.post(`/api/admin/santas-workshop/sessions/${ids.purged}/purge`, { data: { phase, force: true, reason: "e2e clone check" } });
    expect(res.status()).toBe(200);
    expect((await res.json()).done).toBe(true);
  }
  const src = await row(ids.purged);
  expect(src.status).toBe("purged");
  expect(src.personalPurgedAt).not.toBeNull();
  expect(src.publicPurgedAt).not.toBeNull();

  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.purged}`);
  await expect(page.getByRole("heading", { name: "Clone session" })).toBeVisible();
  await fillClone(page, { name: "E2E from purged", slug: `${PREFIX}-frompurged` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/connect\?cloned=1$/);
  const clone = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-frompurged`)))[0];
  expect(clone.status).toBe("draft");
  expect(clone.personalPurgedAt).toBeNull();
  expect(clone.publicPurgedAt).toBeNull();
  expect(clone.windows).toEqual(src.windows);
  expect(clone.questionMap).toEqual(map);
  expect(clone.framePartSize).toBe(40);
  expect(clone.storageQuotaBytes).toBe(300 * MB);
});

test("an unauthenticated clone POST is a 401 and creates nothing", async ({ request }) => {
  const res = await request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-anon`, cloneFrom: ids.src } });
  expect([401, 403, 307]).toContain(res.status());
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-anon`))).toHaveLength(0);
});

test("the clone form has no sideways scroll at 360 px", async ({ page }) => {
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.src}`);
  await expect(page.getByRole("heading", { name: "Clone session" })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await page.goto(`/admin/santas-workshop/${ids.src}`);
  expect(await noSideScroll(page)).toBe(true);
});

// ---------------------------------------------------------------------------
// Slice B (B-210, DECISION-129): "Include the scenes" on Clone session
// ---------------------------------------------------------------------------

const SCENE_TEXT = [
  { title: "Santa arrives", caption: "The sleigh lands on the lawn." },
  { title: "Cocoa & carols", caption: null },
  { title: "Café — goodbye wave", caption: "Everyone says \"see you next year\"." },
];

const scenesOf = async (id: string) => (await db.select().from(swScenes).where(eq(swScenes.sessionId, id))).sort((a, b) => a.position - b.position);
const logOf = async (id: string) => db.select().from(swSessionLog).where(eq(swSessionLog.sessionId, id));

test("clone with scenes: the checkbox names the count and is checked by default; submitting copies title, caption and order and logs a count", async ({ page }) => {
  await signInAsAdmin(page);
  ids.withScenes = await create(page.request, `${PREFIX}-ws`, "practice");
  for (const sc of SCENE_TEXT) {
    const res = await page.request.post(`/api/admin/santas-workshop/sessions/${ids.withScenes}/scenes`, { data: sc });
    expect(res.status()).toBe(201);
  }

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.withScenes}`);
  const box = page.getByTestId("clone-include-scenes").getByRole("checkbox");
  await expect(page.getByTestId("clone-include-scenes")).toContainText("Include the 3 scenes");
  await expect(page.getByTestId("clone-include-scenes")).toContainText("Photos are not copied.");
  await expect(box).toBeChecked();
  expect(await noSideScroll(page)).toBe(true);

  await fillClone(page, { name: "E2E clone with scenes", slug: `${PREFIX}-wsc` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/connect\?cloned=1$/);
  const clone = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-wsc`)))[0];
  expect((await scenesOf(clone.id)).map((r) => [r.title, r.caption, r.position])).toEqual(SCENE_TEXT.map((x, i) => [x.title, x.caption, i]));
  // The source keeps its own rows.
  expect(await scenesOf(ids.withScenes)).toHaveLength(3);
  // One audit row: ids and a count, no scene text.
  const log = await logOf(clone.id);
  expect(log).toHaveLength(1);
  expect(log[0].detail).toEqual({ kind: "practice", clonedFrom: ids.withScenes, scenes: 3 });
  expect(JSON.stringify(log[0].detail)).not.toContain("Santa");

  // The new session's page shows the copied storyline and no copy control (it has scenes).
  await page.goto(`/admin/santas-workshop/${clone.id}`);
  const card = page.getByRole("region", { name: "Storyline scenes" });
  await expect(card.getByTestId("scenes-list").getByText("Cocoa & carols")).toBeVisible();
  await expect(card.getByTestId("scenes-copy")).toHaveCount(0);
});

test("clone with the scenes box unchecked creates a session with no scenes and a log row without a scenes count", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.withScenes}`);
  await page.getByTestId("clone-include-scenes").getByRole("checkbox").uncheck();
  await fillClone(page, { name: "E2E clone no scenes", slug: `${PREFIX}-nsc` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/connect\?cloned=1$/);
  const clone = (await db.select().from(swSessions).where(eq(swSessions.slug, `${PREFIX}-nsc`)))[0];
  expect(await scenesOf(clone.id)).toHaveLength(0);
  const log = await logOf(clone.id);
  expect(log).toHaveLength(1);
  expect(log[0].detail).toEqual({ kind: "practice", clonedFrom: ids.withScenes });
  // The new session's own page offers to copy them later.
  await page.goto(`/admin/santas-workshop/${clone.id}`);
  await expect(page.getByRole("region", { name: "Storyline scenes" }).getByTestId("scenes-copy")).toBeVisible();
});

test("a clone source with no scenes shows no scenes checkbox; the API treats includeScenes on it as a plain clone, and without cloneFrom as nothing to copy", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.src}`);
  await expect(page.getByRole("heading", { name: "Clone session" })).toBeVisible();
  await expect(page.getByTestId("clone-include-scenes")).toHaveCount(0);

  // The form for a brand-new (non-clone) session never shows it either.
  await page.goto("/admin/santas-workshop/new");
  await expect(page.getByTestId("clone-include-scenes")).toHaveCount(0);

  // Source lost its scenes meanwhile (or never had any): the session is still created.
  const plain = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-noscn-a`, cloneFrom: ids.src, includeScenes: true } });
  expect(plain.status(), await plain.text()).toBe(201);
  const plainId = (await plain.json()).session.id as string;
  expect(await scenesOf(plainId)).toHaveLength(0);
  expect((await logOf(plainId))[0].detail).toEqual({ kind: "practice", clonedFrom: ids.src });

  // includeScenes without cloneFrom is dropped, not an error and not a copy.
  const nofrom = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-noscn-b`, includeScenes: true } });
  expect(nofrom.status(), await nofrom.text()).toBe(201);
  const nofromId = (await nofrom.json()).session.id as string;
  expect(await scenesOf(nofromId)).toHaveLength(0);
  expect((await logOf(nofromId))[0].detail).toEqual({ kind: "practice" });

  // A non-boolean is a field error and creates nothing.
  const bad = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-noscn-c`, cloneFrom: ids.withScenes, includeScenes: "yes" } });
  expect(bad.status()).toBe(400);
  expect(JSON.stringify(await bad.json())).toContain("includeScenes");
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-noscn-c`))).toHaveLength(0);
});

test("a scene copy that fails rolls the whole clone back: no session, no scenes, no log row (simulated with a stored scene that no longer validates)", async ({ page }) => {
  await signInAsAdmin(page);
  ids.badScenes = await create(page.request, `${PREFIX}-bad`, "practice");
  // Written straight to the table, bypassing the validator, to stand in for a row that cannot be copied unchanged.
  await db.insert(swScenes).values({ sessionId: ids.badScenes, title: "Call 614 555 0100", caption: null, position: 0 });

  const res = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-badclone`, cloneFrom: ids.badScenes, includeScenes: true } });
  expect(res.status(), await res.text()).toBe(400);
  expect(await res.text()).toContain("Scene 1");
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-badclone`))).toHaveLength(0);

  // The same source without the box still clones (the scenes are simply not asked for).
  const without = await page.request.post("/api/admin/santas-workshop/sessions", { data: { ...defaultSessionDraft("practice"), slug: `${PREFIX}-badclone2`, cloneFrom: ids.badScenes } });
  expect(without.status(), await without.text()).toBe(201);
});

test("through the form, a copy failure leaves the user on the form with the sentence and creates nothing", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/admin/santas-workshop/new?cloneFrom=${ids.badScenes}`);
  await expect(page.getByTestId("clone-include-scenes")).toContainText("Include the 1 scene");
  await fillClone(page, { name: "E2E bad scene clone", slug: `${PREFIX}-badform` });
  await page.getByRole("button", { name: "Create practice session" }).click();
  await expect(page.getByText(/Scene 1 of the other session needs editing there before it can be copied/)).toBeVisible();
  expect(page.url()).toContain("/admin/santas-workshop/new?cloneFrom=");
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-badform`))).toHaveLength(0);
  // Unchecking the box lets the same form succeed.
  await page.getByTestId("clone-include-scenes").getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Create practice session" }).click();
  await page.waitForURL(/\/connect\?cloned=1$/);
  expect(await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.slug, `${PREFIX}-badform`))).toHaveLength(1);
});
