import { test, expect } from "@playwright/test";
import { WORKSHOP_2026 } from "../src/lib/santas-workshop/facts";
import { workshopState } from "../src/lib/santas-workshop/state";
import { bannedHits } from "../src/components/santas-workshop/banned";

// One file runs against the live clock or a dev server started with
// SANTAS_WORKSHOP_NOW on another port (set the same variable for the runner).
// The redirects come from next.config.ts, which the dev server only reads at
// startup: restart it before judging the first two tests.
const now = process.env.SANTAS_WORKSHOP_NOW ? new Date(process.env.SANTAS_WORKSHOP_NOW) : new Date();
const expected = workshopState(now, WORKSHOP_2026);

test.describe("santas workshop page", () => {
  test("/santasworkshop is a 307 to /santas-workshop carrying exactly three UTM tags", async ({ request }) => {
    const res = await request.get("/santasworkshop", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const loc = new URL(res.headers()["location"], "http://localhost");
    expect(loc.pathname).toBe("/santas-workshop");
    expect([...loc.searchParams.keys()].sort()).toEqual(["utm_campaign", "utm_medium", "utm_source"]);
  });

  test("/santas-workshop/preview and a deep preview path are 307s to /santas-workshop", async ({ request }) => {
    for (const p of ["/santas-workshop/preview", "/santas-workshop/preview/check-in"]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(307);
      expect(new URL(res.headers()["location"], "http://localhost").pathname, p).toBe("/santas-workshop");
    }
  });

  test("returns 200 with one h1, data-state as expected, and no horizontal scroll at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const res = await page.goto("/santas-workshop");
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByTestId("workshop-page")).toHaveAttribute("data-state", expected);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("head carries canonical, Open Graph and Twitter tags, no noindex", async ({ page }) => {
    await page.goto("/santas-workshop");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://westervillelions.org/santas-workshop");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Santa's Workshop \| Westerville Lions Club/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    expect(await page.locator('meta[name="robots"]').count()).toBe(0);
    const title = await page.title();
    expect(title.match(/Westerville Lions Club/g)?.length ?? 0).toBe(1);
  });

  test("the iframe exists only in open, with title, an embed src and allow=payment", async ({ request, page }) => {
    const html = await (await request.get("/santas-workshop")).text();
    await page.goto("/santas-workshop");
    const frames = page.locator("iframe[title^='Sign-up form']");
    if (expected === "open" && WORKSHOP_2026.zeffyShareUrl !== "") {
      await expect(frames).toHaveCount(1);
      expect((await frames.getAttribute("src")) ?? "").toMatch(/^https:\/\/www\.zeffy\.com\/embed\//);
      await expect(frames).toHaveAttribute("allow", "payment");
      expect(html).toContain("<noscript>");
    } else {
      await expect(frames).toHaveCount(0);
      expect(html).not.toContain("zeffy.com");
    }
  });

  test("open without a form URL says so; before shows the opening date; closed and after are full pages", async ({ page }) => {
    await page.goto("/santas-workshop");
    if (expected === "before") {
      await expect(page.getByText("Registration opens Sunday, Nov 8").first()).toBeVisible();
      await expect(page.locator('a[href="#signup"]')).toHaveCount(0);
    }
    if (expected === "open" && WORKSHOP_2026.zeffyShareUrl === "") {
      await expect(page.getByText("The sign-up form is not ready yet.")).toBeVisible();
    }
    if (expected === "closed") await expect(page.getByText("Sign-ups for this year are closed").first()).toBeVisible();
    if (expected === "after") await expect(page.getByRole("heading", { name: "Thank you for riding with us" })).toBeVisible();
    expect((await page.locator("main, body").first().innerText()).length).toBeGreaterThan(500);
  });

  test("ignores ?state= and ?now= and never renders a query value", async ({ page }) => {
    await page.goto("/santas-workshop?state=after&now=2027-01-01T00:00:00Z&x=ZZQUERYMARKERZZ");
    await expect(page.getByTestId("workshop-page")).toHaveAttribute("data-state", expected);
    expect(await page.getByTestId("workshop-page").innerHTML()).not.toContain("ZZQUERYMARKERZZ");
  });

  test("the visible text passes the banned-pattern scan", async ({ page }) => {
    await page.goto("/santas-workshop");
    const text = await page.getByTestId("workshop-page").innerText();
    expect(bannedHits(text)).toEqual([]);
  });

  test("sitemap.xml lists /santas-workshop and /privacy has the section", async ({ request, page }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("/santas-workshop</loc>");
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "A Visit to Santa's Workshop" })).toBeVisible();
  });

  test("the first sign-up control is visible within a 390x844 viewport (open only)", async ({ page }) => {
    test.skip(expected !== "open" || WORKSHOP_2026.zeffyShareUrl === "", "only meaningful with a live form");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/santas-workshop");
    await expect(page.getByRole("link", { name: /^Sign up, \$15 per stuffy$/ })).toBeInViewport();
  });

  test("no console error or CSP violation while the page loads", async ({ page }) => {
    const errors: string[] = [];
    // Only our own messages: anything logged from inside the embedded zeffy.com
    // frame is third-party. A CSP violation caused by the embed is still reported
    // against this page's origin, so it is still caught here.
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const host = (() => {
        try {
          return new URL(m.location().url).hostname;
        } catch {
          return "";
        }
      })();
      if (host.endsWith("zeffy.com")) return;
      errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/santas-workshop");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
});
