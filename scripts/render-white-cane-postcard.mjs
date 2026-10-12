// Renders the White Cane 6 x 4 in postcard (docs/marketing/white-cane-poster/postcard-4x6.html)
// four ways: a print-ready single-card PDF, a 6.25 x 4.25 in PDF with a 0.125 in bleed for a print shop, a 1800 x 1200 px JPEG (300 ppi) for a photo
// counter's 4x6 print service, and a letter-size two-up PDF with crop marks for home printing.
// Uses the Playwright Chromium already installed for e2e tests. No database, no network.
//
//   node scripts/render-white-cane-postcard.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/marketing/white-cane-poster");
const browser = await chromium.launch();

const card = await browser.newPage({ viewport: { width: 576, height: 384 }, deviceScaleFactor: 3.125 });
await card.goto("file://" + path.join(dir, "postcard-4x6.html"), { waitUntil: "load" });
await card.waitForTimeout(300);
await card.pdf({ path: path.join(dir, "white-cane-postcard-4x6.pdf"), width: "6in", height: "4in", printBackground: true, preferCSSPageSize: true });
await card.screenshot({ path: path.join(dir, "white-cane-postcard-4x6.jpg"), type: "jpeg", quality: 92 });
await card.close();

const bleed = await browser.newPage({ viewport: { width: 600, height: 408 }, deviceScaleFactor: 3 });
await bleed.goto("file://" + path.join(dir, "postcard-4x6-bleed.html"), { waitUntil: "load" });
await bleed.waitForTimeout(300);
await bleed.pdf({ path: path.join(dir, "white-cane-postcard-4x6-bleed.pdf"), width: "6.25in", height: "4.25in", printBackground: true, preferCSSPageSize: true });
await bleed.close();

const sheet = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1 });
await sheet.goto("file://" + path.join(dir, "postcard-2up-letter.html"), { waitUntil: "load" });
await sheet.waitForTimeout(500);
await sheet.pdf({ path: path.join(dir, "white-cane-postcard-2up-letter.pdf"), width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true });
await sheet.close();

await browser.close();
console.log("Rendered white-cane-postcard-4x6.pdf, -4x6-bleed.pdf, -4x6.jpg and -2up-letter.pdf in", dir);
