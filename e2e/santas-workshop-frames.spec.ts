import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { db } from "../src/lib/db";
import { swPhotos, swStuffies } from "../src/lib/db/schema";
import { parseJpegHeader } from "../src/lib/santas-workshop/jpeg-header";
import { readJpegDensity } from "../src/lib/santas-workshop/jpeg-dpi";
import { adminPage, cleanupSession, createPracticeSession, manualAdd, seedPhoto, uniqueSlug, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop Slice 4 (e2e): the admin Frames page. A practice session (the origin guard exempts it)
 * with three stuffies that have portraits and one that does not. Fake names only; removed in afterAll.
 * Run against the pipeline server: PLAYWRIGHT_BASE_URL=http://localhost:3101 pnpm test:e2e e2e/santas-workshop-frames.spec.ts
 */
const SLUG = uniqueSlug("e2e-frm");
const STARTED = new Date(Date.now() - 1000);
const NAMES = ["Alpha Bear", 'Bruno, "Big" B', "Cleo Cat"];
let sw: TestSession;
const ids: Record<string, string> = {};
const photos: Record<string, string> = {};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 900 } });
test.setTimeout(120_000);

test.afterAll(async () => {
  await cleanupSession(SLUG, STARTED);
});

async function prepare(page: Page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/frames/manifest") && r.request().method() === "POST"),
    page.getByRole("button", { name: /Prepare export/ }).click(),
  ]);
  expect(res.status()).toBe(200);
  return (await res.json()) as { items: { stuffyId: string; exportStatus: string; frameNumber: number; fileName: string }[]; counts: { changedSinceExport: number } };
}

test("seed: three stuffies with portraits, one without", async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG, true);
  let n = 0;
  for (const name of NAMES) {
    const r = await manualAdd(admin.request, sw.id, { stuffy: name, parentLast: `Fam${n}` });
    ids[name] = r.id;
    photos[name] = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: r.id, rgb: [40 + n * 60, 80, 200 - n * 50], takenAt: new Date(Date.now() + n * 1000) });
    n += 1;
  }
  await manualAdd(admin.request, sw.id, { stuffy: "No Portrait Pup", parentLast: "Fam9" });
  await admin.close();
});

test("prepare shows 3 to produce and 1 withheld with the reason", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/frames`);
  const m = await prepare(page);
  expect(m.items).toHaveLength(3);
  await expect(page.getByTestId("count-produce")).toHaveText("3");
  await expect(page.getByTestId("count-withheld")).toHaveText("1");
  await expect(page.getByTestId("retaken-count")).toHaveText("0");
  await expect(page.getByTestId("withheld-list")).toContainText("No Portrait Pup: no portrait taken yet");
  await page.close();
});

test("export downloads one part: three 1200x1800 JPEGs at 300 dpi and an index with produced=yes", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/frames`);
  await prepare(page);

  const [exported] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/frames/exported") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Export frames" }).click(),
  ]);
  expect(exported.status()).toBe(200);
  expect(await exported.json()).toMatchObject({ marked: 3, unchanged: 0, rejected: [] });

  await expect(page.getByTestId("frame-summary")).toContainText("3 of 3 frames done.", { timeout: 90_000 });
  await expect(page.getByTestId("part-list").locator("li")).toHaveCount(1);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Download part 1 of 1/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^ssw-.*-frames-part-1-of-1\.zip$/);
  const files = unzipSync(new Uint8Array(readFileSync((await download.path()) as string)));
  const jpgs = Object.keys(files).filter((f) => f.endsWith(".jpg")).sort();
  expect(jpgs).toHaveLength(3);
  for (const f of jpgs) {
    expect(parseJpegHeader(files[f])).toMatchObject({ ok: true, width: 1200, height: 1800 });
    expect(readJpegDensity(files[f])).toEqual({ units: 1, x: 300, y: 300 });
  }
  // The zip holds pictures only: nothing with parent names goes to the photo counter.
  expect(Object.keys(files).every((f) => f.endsWith(".jpg"))).toBe(true);
  expect(Object.keys(files)).not.toContain("index.csv");

  // The index is a separate admin-only download with every stuffy and the produced column.
  await expect(page.getByText("The zips hold only pictures")).toBeVisible();
  const [csvDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download index (admin only)" }).click()]);
  const csv = readFileSync((await csvDownload.path()) as string, "utf8");
  const rows = csv.trimEnd().split("\r\n");
  expect(rows[0]).toContain("produced");
  expect(rows).toHaveLength(1 + 4);
  expect(rows.filter((r) => r.includes(",yes,"))).toHaveLength(3);
  expect(csv).toContain('"Bruno, ""Big"" B"');
  expect(csv).toContain("No Portrait Pup");
  expect(csv).toContain("No frame: no portrait taken yet");

  // Marked in the database against the portraits that were composited.
  for (const name of NAMES) {
    const [row] = await db.select({ p: swStuffies.frameExportedPhotoId }).from(swStuffies).where(eq(swStuffies.id, ids[name]));
    expect(row.p).toBe(photos[name]);
  }
  await page.close();
});

test("next manifest reads every frame as current; a retake reads changed and the indicator shows 1", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/frames`);
  const before = await prepare(page);
  expect(before.items.every((i) => i.exportStatus === "current")).toBe(true);
  await expect(page.getByTestId("retaken-count")).toHaveText("0");
  const firstNumbers = before.items.map((i) => `${i.stuffyId}:${i.frameNumber}`);

  // Retake Cleo's portrait: supersede the old one first (one current portrait per stuffy), then add the new one.
  const cleo = ids["Cleo Cat"];
  await db.update(swPhotos).set({ supersededAt: new Date() }).where(eq(swPhotos.id, photos["Cleo Cat"]));
  const fresh = await seedPhoto(sw.id, SLUG, { kind: "portrait", stuffyId: cleo, rgb: [220, 40, 40], takenAt: new Date() });
  await db.update(swPhotos).set({ supersededByPhotoId: fresh }).where(eq(swPhotos.id, photos["Cleo Cat"]));

  const after = await prepare(page);
  expect(after.items.find((i) => i.stuffyId === cleo)?.exportStatus).toBe("changed");
  expect(after.items.filter((i) => i.exportStatus === "current")).toHaveLength(2);
  expect(after.counts.changedSinceExport).toBe(1);
  await expect(page.getByTestId("retaken-count")).toHaveText("1");
  // Frame numbers are stable across exports.
  expect(after.items.map((i) => `${i.stuffyId}:${i.frameNumber}`).sort()).toEqual(firstNumbers.sort());
  await page.close();
});

test("a partial export counts against its own target and names its zip distinctly", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}/frames`);
  await prepare(page);
  await expect(page.getByTestId("last-export")).toContainText(/ ET$/);
  const [exported] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/frames/exported") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Export only new and retaken (1)" }).click(),
  ]);
  expect(await exported.json()).toMatchObject({ marked: 1, rejected: [] });
  await expect(page.getByTestId("frame-summary")).toContainText("1 of 1 frame done.", { timeout: 60_000 });
  await expect(page.getByTestId("frame-summary")).not.toContainText("of 3");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Download part 1 of 1/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/-frames-part-1-of-1-new\.zip$/);
  const files = unzipSync(new Uint8Array(readFileSync((await download.path()) as string)));
  const names = Object.keys(files);
  expect(names).toHaveLength(1);
  // A retaken frame never reuses the earlier upload's name: the portrait's short id is appended.
  expect(names[0]).toMatch(/-\d{3}-[a-z0-9]{6}\.jpg$/);
  await page.close();
});

test("a phone-width screen is told to use a laptop; the nav has a Frames tab", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`/admin/santas-workshop/${sw.id}`);
  await expect(page.getByRole("navigation", { name: "Session sections" }).getByRole("link", { name: "Frames" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/admin/santas-workshop/${sw.id}/frames`);
  await expect(page.getByText("Use a laptop for this step")).toBeVisible();
  await expect(page.getByRole("button", { name: /Prepare export/ })).toBeHidden();
  await page.close();
});
