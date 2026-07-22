import { test, expect } from "@playwright/test";
import path from "path";
import { signInAsAdmin } from "./helpers/auth";

/**
 * HEIC receipt upload — WASM decode fallback (Chrome/Firefox).
 *
 * Covers the Phase 5 verification flows from
 * docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md: rows #1 (Chrome
 * WASM happy path) and #3/#4 (WASM decode failure — corrupt file and a
 * `.heic`-named file that isn't real HEIC) of that work-log's manual
 * click-through matrix. Playwright's `chromium` project (this repo's only
 * configured browser, see playwright.config.ts) does not decode HEIC
 * natively — confirmed directly during Phase 5 verification via
 * `createImageBitmap()` on the same fixture used below, which rejects with
 * "InvalidStateError: The source image could not be decoded." — so these
 * tests genuinely exercise the WASM fallback path, not a native-decode
 * short-circuit. The decoder behind that fallback was originally
 * `heic2any`; it's now `libheif-js`
 * (docs/work-log/2026-07-21-heic-modern-iphone-decode.md, DECISION-039) —
 * the trigger condition, WASM-chunk-load-vs-decode stage split, and error
 * copy this spec asserts on are unchanged by that swap.
 *
 * Fixtures (e2e/fixtures/heic/) — provenance predates the decoder swap;
 * the fixture files themselves are unchanged and still exercise the same
 * wiring against the new decoder:
 *   - valid.heic: a real HEIC photo pulled from heic2any's own repo demo
 *     assets (https://github.com/alexcorvi/heic2any/tree/master/demo,
 *     MIT-licensed project), used here purely as decode-test input.
 *   - corrupt.heic: the first 8000 bytes of valid.heic — a truncated file
 *     with a valid-looking ftyp header but incomplete/corrupt HEVC payload,
 *     so it reaches the WASM decoder's decode step and fails there (not at
 *     the chunk-load step).
 *   - not-actually-heic.heic: plain text renamed to a `.heic` extension —
 *     exercises isHeicFile()'s extension-only detection (Phase 1 Gap /
 *     Phase 3 edge case: "a .heic-named file that isn't real HEIC").
 */

const FIXTURES_DIR = path.join(__dirname, "fixtures", "heic");

test.describe("admin ledger receipt upload — HEIC WASM fallback", () => {
  test("uploads a real HEIC file via the WASM decoder and shows it ready to attach", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/all");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    await page.locator("label").filter({ hasText: /^Expense$/ }).click();

    // Act
    const fileInput = page.locator('input[type="file"][id^="receipt-file-input"]');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, "valid.heic"));

    // Assert — "Preparing photo…" appears while the WASM chunk fetches and
    // decodes (this is the whole reason Status split into preparing/
    // uploading — see Phase 3 design), then the receipt lands as "ready to
    // attach" once the upload completes. No error text at any point.
    await expect(page.getByText(/ready to attach/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("shows the file/content-oriented error for a corrupt HEIC file, not the connectivity message", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/all");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    await page.locator("label").filter({ hasText: /^Expense$/ }).click();

    // Act
    const fileInput = page.locator('input[type="file"][id^="receipt-file-input"]');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, "corrupt.heic"));

    // Assert — the WASM chunk loads fine (this isn't a connectivity
    // failure), but decoding the truncated bytes fails, so the admin must
    // see the "decode" message, never the "chunk-load" one, and never the
    // retired "use Safari" copy.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(/may not be a valid HEIC file/i);
    await expect(alert).not.toContainText(/Safari/i);
    await expect(alert).not.toContainText(/check your connection/i);
  });

  test("fails cleanly (not a hang) for a .heic-named file that isn't real HEIC", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/ledger/all");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    await page.locator("label").filter({ hasText: /^Expense$/ }).click();

    // Act
    const fileInput = page.locator('input[type="file"][id^="receipt-file-input"]');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, "not-actually-heic.heic"));

    // Assert — same "decode" classification as the corrupt-file case, and
    // resolves promptly rather than hanging (bounded by the same timeout
    // used above, well under it in practice for a tiny file).
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(/may not be a valid HEIC file/i);
  });
});
