// Renders docs/marketing/white-cane-poster/poster-board.html to the
// print-ready 22 x 28 in PDF and a PNG preview, using the Playwright Chromium
// already installed for e2e tests. No database, no network.
//
//   node scripts/render-white-cane-poster.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/marketing/white-cane-poster");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2112, height: 2688 }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(dir, "poster-board.html"), { waitUntil: "load" });
await page.waitForTimeout(500);
await page.pdf({
  path: path.join(dir, "white-cane-poster-22x28.pdf"),
  width: "22in",
  height: "28in",
  printBackground: true,
  preferCSSPageSize: true,
});
await page.screenshot({ path: path.join(dir, "white-cane-poster-22x28-preview.jpg"), type: "jpeg", quality: 82 });
await browser.close();
console.log("Rendered white-cane-poster-22x28.pdf and -preview.jpg in", dir);
