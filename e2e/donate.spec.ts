import { test, expect } from "@playwright/test";

// Guards two production regressions from June 2026:
//  1. Every donation card must render an image. The "Donate to Lions Club"
//     campaign has no stored image and used to scrape Zeffy's og:image at
//     request time; Zeffy's Cloudflare now 403s server fetches, so the card
//     rendered image-less. A local fallback now guarantees an image.
//  2. The Zeffy donation iframe must be allowed by our Content-Security-Policy
//     frame-src. When it wasn't, the browser blocked it with
//     "This content is blocked. Contact the site owner to fix the issue."
test.describe("donate page", () => {
  test("renders campaign cards, each with an image", async ({ page }) => {
    await page.goto("/donate");

    await expect(page.locator("h1")).toContainText(/Support Our Mission/i);

    const cards = page.getByTestId("campaign-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Regression #1: every card shows an image (stored or fallback), never blank.
    for (let i = 0; i < count; i++) {
      const image = cards.nth(i).getByTestId("campaign-card-image");
      await expect(image).toBeVisible();
      const src = await image.getAttribute("src");
      expect(src ?? "").not.toBe("");
    }
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
