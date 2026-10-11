import { test, expect, type Page } from "@playwright/test";

/**
 * Santa's Workshop prototype (docs/work-log/2026-10-11-santas-workshop-signup.md,
 * DECISION-118). Public, anonymous, no database, no email: nothing here signs in
 * or writes. Guards the "unlisted" promise and the phone behaviours that unit
 * tests cannot reach (Vitest runs in a node environment).
 */

const BASE = "/santas-workshop/preview";
const SCREENS = [
  BASE,
  `${BASE}/confirmed`,
  `${BASE}/follow`,
  `${BASE}/book`,
  `${BASE}/check-in`,
  `${BASE}/photo-station`,
  `${BASE}/art`,
];

const stateRadio = (page: Page, label: string) => page.getByLabel(label, { exact: true });

test.describe("Santa's Workshop prototype stays unlisted", () => {
  test("should return 404 at /santas-workshop, which is reserved for the production page", async ({ request }) => {
    const res = await request.get("/santas-workshop", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });

  test("should not mention the prototype in the sitemap or robots.txt", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const robots = await (await request.get("/robots.txt")).text();
    expect(sitemap.toLowerCase()).not.toContain("santas-workshop");
    expect(robots.toLowerCase()).not.toContain("santas-workshop");
  });

  for (const path of SCREENS) {
    test(`should carry noindex, the prototype banner and one h1 on ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        "Santa's Workshop (prototype)",
      );
      await expect(page.getByRole("note").filter({ hasText: "nothing here is real or saved" })).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }
});

test.describe("Santa's Workshop prototype landing states", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("should show the pinned Reserve bar on a phone only while sign-ups are Open", async ({ page }) => {
    await page.goto(BASE);
    const bar = page.locator(".fixed").filter({ hasText: "per stuffy" }).filter({ hasText: "Reserve a spot" });

    await expect(bar).toBeVisible();
    for (const label of ["Before it opens", "Full", "After the event"]) {
      await stateRadio(page, label).check({ force: true });
      await expect(bar).toHaveCount(0);
    }
  });

  test("should keep the chosen state across soft navigation and reset it on reload", async ({ page }) => {
    await page.goto(BASE);
    await stateRadio(page, "Full").check({ force: true });

    await page.getByRole("link", { name: "Booked", exact: true }).click();
    await page.waitForURL(`**${BASE}/confirmed`);
    await page.getByRole("link", { name: "Sign up", exact: true }).click();
    await page.waitForURL(`**${BASE}`);
    await expect(stateRadio(page, "Full")).toBeChecked();

    await page.reload();
    await expect(stateRadio(page, "Open")).toBeChecked();
    expect(new URL(page.url()).search).toBe("");
  });

  test("should not scroll horizontally on any screen at 360px", async ({ page }) => {
    for (const path of SCREENS) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("should not let the pinned Reserve bar cover the site footer at the end of the page — regression for the bar re-appearing after the end-of-page sentinel scrolls out of view", async ({
    page,
  }) => {
    await page.goto(BASE);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);

    const covered = await page.evaluate(() => {
      const bar = [...document.querySelectorAll(".fixed")].find((e) => /Reserve a spot/.test(e.textContent ?? ""));
      if (!bar) return [];
      const top = bar.getBoundingClientRect().top;
      return [...document.querySelectorAll("footer a")]
        .filter((a) => a.getBoundingClientRect().bottom > top && a.getBoundingClientRect().top < window.innerHeight)
        .map((a) => (a.textContent ?? "").trim());
    });

    expect(covered).toEqual([]);
  });
});

test.describe("Santa's Workshop prototype accessibility", () => {
  test("should not skip heading levels inside the prototype on any screen — regression for the memory book jumping from h1 to h3", async ({
    page,
  }) => {
    for (const path of SCREENS) {
      await page.goto(path);
      const jumps = await page.evaluate(() => {
        const levels = [...document.querySelectorAll(".sw-root h1,.sw-root h2,.sw-root h3,.sw-root h4")].map(
          (h) => Number(h.tagName[1]),
        );
        const out: string[] = [];
        let prev = 0;
        for (const l of levels) {
          if (l > prev + 1) out.push(`h${prev} to h${l}`);
          prev = l;
        }
        return out;
      });
      expect(jumps, path).toEqual([]);
    }
  });

  test("should let the delivery radiogroup be operated with the arrow keys", async ({ page }) => {
    await page.goto(`${BASE}/book`);
    const radios = page.getByRole("radiogroup").getByRole("radio");

    await expect(radios).toHaveCount(3);
    await expect(radios.nth(1)).toBeChecked();
    await radios.nth(1).focus();
    await page.keyboard.press("ArrowDown");
    await expect(radios.nth(2)).toBeChecked();
  });
});

test.describe("Santa's Workshop prototype keeps nothing", () => {
  test("should reset the conductor check-in on reload and write nothing to browser storage", async ({ page }) => {
    await page.goto(`${BASE}/check-in`);
    const counter = page.locator("p[aria-live='polite']").first();
    const before = (await counter.innerText()).trim();

    await page.getByLabel("Find a stuffy").fill("pip");
    await page.getByRole("button", { name: /Check in for Pip/ }).click();
    await expect(counter).not.toHaveText(before);

    await page.reload();
    await expect(page.locator("p[aria-live='polite']").first()).toHaveText(before);
    const stored = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookie: document.cookie,
    }));
    expect(stored).toEqual({ local: 0, session: 0, cookie: "" });
  });
});
