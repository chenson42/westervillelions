import { test, expect } from "@playwright/test";
import { cleanupSession, createPracticeSession, crewContext, enterCode, fakeIp, setStatus, uniqueSlug, adminPage, type TestSession } from "./helpers/santas-workshop-crew";

/**
 * Santa's Workshop Slice 2 (e2e: code entry and throttle). A visitor without the
 * worker cookie sees only the code screen, whatever the address. A wrong code, an
 * unknown session and a session that is not active all answer the same way. After
 * five wrong codes from one address even the right one waits. Pause and rotate
 * take effect on the very next request. Practice session, fake IPs, rows removed.
 *
 * Run against the pipeline server:  PLAYWRIGHT_BASE_URL=http://localhost:3101 pnpm test:e2e e2e/santas-workshop-crew-entry.spec.ts
 */
const SLUG = uniqueSlug("e2e-entry");
const STARTED = new Date(Date.now() - 1000);
let sw: TestSession;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const admin = await adminPage(browser);
  sw = await createPracticeSession(admin.request, SLUG);
  await admin.close();
});

test.afterAll(async () => {
  await cleanupSession(SLUG, STARTED);
});

test("a visitor with no cookie sees only the code screen, and nothing about the session", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await page.goto(`/santas-workshop/crew/${SLUG}`);
  await expect(page.getByRole("heading", { name: "Enter the worker code" })).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("E2E crew");
  await expect(page.getByRole("navigation", { name: "Crew sections" })).toHaveCount(0);
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  expect(robots).toContain("noindex");
  await context.close();
});

test("an unknown session and a wrong code look identical", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await page.goto(`/santas-workshop/crew/no-such-session-${Date.now()}`);
  await expect(page.getByRole("heading", { name: "Enter the worker code" })).toBeVisible();
  await page.getByLabel("Worker code").fill("WRONGCODE");
  await page.getByRole("button", { name: "Start" }).click();
  const unknown = await page.locator('form [role="alert"]').innerText();

  await page.goto(`/santas-workshop/crew/${SLUG}`);
  await page.getByLabel("Worker code").fill("WRONGCODE");
  await page.getByRole("button", { name: "Start" }).click();
  const wrong = await page.locator('form [role="alert"]').innerText();
  expect(unknown).toBe(wrong);
  expect(wrong).toBe("That code didn't work. Ask the event chair.");
  await context.close();
});

test("the right code opens the app; capitals, spaces and dashes do not matter", async ({ browser }) => {
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.formatted.toLowerCase().replace("-", " "));
  await expect(page.getByRole("navigation", { name: "Crew sections" })).toBeVisible();
  await expect(page.getByText("Practice run: nothing here is real")).toBeVisible();
  await context.close();
});

test("five wrong codes from one address block even the right one, with the wait sentence", async ({ browser }) => {
  const { context, page } = await crewContext(browser, fakeIp());
  await page.goto(`/santas-workshop/crew/${SLUG}`);
  for (let i = 0; i < 5; i += 1) {
    await page.getByLabel("Worker code").fill(`NOPE${i}NOPE`);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.locator('form [role="alert"]')).toBeVisible();
  }
  await page.getByLabel("Worker code").fill(sw.code);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator('form [role="alert"]')).toContainText("Wait a few minutes");
  await expect(page.getByRole("navigation", { name: "Crew sections" })).toHaveCount(0);
  await context.close();

  // Another address is unaffected.
  const other = await crewContext(browser, fakeIp());
  await enterCode(other.page, SLUG, sw.code);
  await other.context.close();
});

test("pause and rotate take effect on the worker's next request, with a plain reason", async ({ browser }) => {
  const admin = await adminPage(browser);
  const { context, page } = await crewContext(browser);
  await enterCode(page, SLUG, sw.code);

  const pause = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/crew-code`, { data: { action: "pause" } });
  expect(pause.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "paused" })).toBeVisible();
  const resume = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/crew-code`, { data: { action: "resume" } });
  expect(resume.status()).toBe(200);

  // Rotate: the cookie holder is signed out, with the reason, and the old code no longer works.
  const rotate = await admin.request.post(`/api/admin/santas-workshop/sessions/${sw.id}/crew-code`, { data: { action: "rotate", acknowledge: true } });
  expect(rotate.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "code was changed" })).toBeVisible();
  const newCode = ((await rotate.json()) as { code: string }).code;
  await page.getByLabel("Worker code").fill(newCode);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("navigation", { name: "Crew sections" })).toBeVisible();
  await context.close();

  // Closed: the crew is locked out with the reason, the admin is not.
  await setStatus(admin.request, sw.id, "closed");
  const closed = await crewContext(browser);
  await closed.page.goto(`/santas-workshop/crew/${SLUG}`);
  await expect(closed.page.getByRole("heading", { name: "Enter the worker code" })).toBeVisible();
  await closed.context.close();
  await admin.goto(`/santas-workshop/crew/${SLUG}`);
  await expect(admin.getByText(/This session is closed/)).toBeVisible();
  await admin.close();
});
