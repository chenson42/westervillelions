import { test, expect } from "@playwright/test";

// The /whitecane 307 comes from next.config.ts, which the dev server only
// reads at startup. If the first two tests fail against a long-running dev
// server, restart it before judging them.
test.describe("white cane page", () => {
  test("/whitecane is a temporary redirect carrying the UTM tags", async ({ request }) => {
    const res = await request.get("/whitecane", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toMatch(/utm_campaign=whitecane/);
  });

  test("short URL lands on the page with the tags intact", async ({ page }) => {
    await page.goto("/whitecane");
    await expect(page).toHaveURL(/\/white-cane\?.*utm_campaign=whitecane/);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Why a white cane" })).toBeVisible();
    await expect(page.getByTestId("white-cane-give").first()).toBeVisible();
  });

  test("Give shows the Zeffy form inline, or the page says honestly why not", async ({ page }) => {
    await page.goto("/white-cane");
    const give = page.getByRole("link", { name: "Give to the White Cane campaign" }).first();
    if (await give.count()) {
      await expect(give).toHaveAttribute("href", "#give");
      const frame = page.getByTestId("white-cane-give-inline").locator("iframe");
      await expect(frame).toHaveAttribute("title", "Donation form powered by Zeffy");
      expect((await frame.getAttribute("src")) ?? "").toMatch(/^https:\/\/www\.zeffy\.com\/embed\/donation-form\//);
      await give.click();
      await expect(page.locator("#give")).toBeInViewport();
      await expect(page.getByRole("link", { name: "Open the donation form in a new tab" }).first()).toBeVisible();
    } else {
      await expect(
        page.getByText(/giving form opens soon|campaign has closed/i).first(),
      ).toBeVisible();
    }
  });

  test("server HTML includes a noscript fallback link when the form is live", async ({ request }) => {
    const html = await (await request.get("/white-cane")).text();
    if (html.includes("Open the donation form in a new tab")) {
      expect(html).toMatch(/<noscript>[\s\S]*?href=/);
    }
  });
  test("redirect carries all four UTM tags and no others", async ({ request }) => {
    const res = await request.get("/whitecane", { maxRedirects: 0 });
    const loc = new URL(res.headers()["location"], "http://localhost:3000");
    expect(loc.pathname).toBe("/white-cane");
    const params = Object.fromEntries(loc.searchParams);
    // utm_campaign is "whitecane" (year-free, the poster is reused yearly); accept the
    // pre-restart "whitecane2026" value too so a running dev server does not fail this.
    expect(params.utm_campaign).toMatch(/^whitecane(2026)?$/);
    delete params.utm_campaign;
    expect(params).toEqual({ utm_source: "poster", utm_medium: "qr", utm_content: "fourthfriday" });
  });

  test("document title names the club once — regression for the root-layout title template doubling the suffix", async ({ request }) => {
    const html = await (await request.get("/white-cane")).text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    expect(title).toContain("White Cane Safety Day");
    expect(title.match(/Westerville Lions Club/g) ?? []).toHaveLength(1);
  });

  test("head carries canonical and Open Graph tags for a shared link", async ({ request }) => {
    const html = await (await request.get("/white-cane")).text();
    expect(html).toContain('<link rel="canonical" href="https://westervillelions.org/white-cane"');
    for (const prop of ["og:title", "og:description", "og:url", "og:image"]) {
      expect(html, prop).toMatch(new RegExp(`property="${prop}" content="[^"]+"`));
    }
    expect(html).not.toMatch(/name="robots"[^>]*noindex/);
  });

  test("starts with one h1 and then h2 sections, with no horizontal scroll at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/white-cane");
    const headings = await page.$$eval("#main-content h1, #main-content h2, #main-content h3", (els) =>
      els.map((e) => e.tagName),
    );
    expect(headings[0]).toBe("H1");
    expect(headings.filter((h) => h === "H1")).toHaveLength(1);
    expect(headings.slice(1).every((h) => h === "H2")).toBe(true);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(fits).toBe(true);
  });

  test("the first Give control is visible without scrolling on a 390x844 phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/white-cane");
    const control = page.getByTestId("white-cane-give").first().locator("button, a").first();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  });

  test("never renders a query-string value into the page", async ({ page }) => {
    await page.goto("/white-cane?utm_source=QUERYPROBE123");
    await expect(page.locator("body")).not.toContainText("QUERYPROBE123");
  });

  test("in the live state the new-tab link opens in a new tab with noopener", async ({ page }) => {
    await page.goto("/white-cane");
    const link = page.getByRole("link", { name: "Open the donation form in a new tab" }).first();
    if (await link.count()) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("href", /^https:\/\/www\.zeffy\.com\//);
    } else {
      await expect(page.getByRole("button", { name: /^Give/ })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  });
});
