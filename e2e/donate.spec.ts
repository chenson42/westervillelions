import { test, expect } from "@playwright/test";

// Guards production regressions:
//  1. (June 2026) The "Donate to Lions Club" campaign has no stored image and
//     used to scrape Zeffy's og:image at request time; Zeffy's Cloudflare now
//     403s server fetches, so the card rendered a broken image. From
//     2026-10-12 a card with no stored image renders NO image element at all
//     (no brand fallback), and every card carries a visible title, so the
//     card is never blank and never shows a broken picture.
//  2. The Zeffy donation iframe must be allowed by our Content-Security-Policy
//     frame-src. When it wasn't, the browser blocked it with
//     "This content is blocked. Contact the site owner to fix the issue."
test.describe("donate page", () => {
  test("renders campaign cards with a title, and an image only when one is stored", async ({ page }) => {
    await page.goto("/donate");

    await expect(page.locator("h1")).toContainText(/Support Our Mission/i);

    const cards = page.getByTestId("campaign-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      await expect(card.getByTestId("campaign-card-title")).toBeVisible();
      await expect(card.getByTestId("campaign-card-title")).not.toHaveText("");
      // Regression #1: no fallback picture. An image element exists only for a
      // stored image, and then it must point somewhere.
      const images = card.getByTestId("campaign-card-image");
      const n = await images.count();
      expect(n).toBeLessThanOrEqual(1);
      if (n === 1) {
        const src = await images.first().getAttribute("src");
        expect(src ?? "").not.toBe("");
        expect(src ?? "").not.toContain("service-community");
      }
    }

    // Cards in one row share a height (the grid stretches them).
    const boxes = [];
    for (let i = 0; i < count; i++) boxes.push(await cards.nth(i).boundingBox());
    const rows = new Map<number, number[]>();
    for (const b of boxes) if (b) rows.set(Math.round(b.y), [...(rows.get(Math.round(b.y)) ?? []), Math.round(b.height)]);
    for (const heights of rows.values()) expect(new Set(heights).size).toBe(1);
  });

  test("opening a campaign shows the Zeffy donation iframe", async ({ page }) => {
    await page.goto("/donate");

    await page.getByTestId("campaign-card").first().getByRole("button").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const iframe = dialog.locator('iframe[title="Donation form powered by Zeffy"]');
    await expect(iframe).toHaveCount(1);
    expect(await iframe.getAttribute("src")).toMatch(/zeffy\.com\/embed\//);
  });

  test("CSP frame-src allows the Zeffy donation iframe", async ({ request }) => {
    // Regression #2: without zeffy.com in frame-src the browser blocks the embed.
    const res = await request.get("/donate");
    const csp = res.headers()["content-security-policy"] ?? "";
    const frameSrc =
      csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith("frame-src")) ?? "";
    expect(frameSrc).toContain("https://www.zeffy.com");
  });
});
