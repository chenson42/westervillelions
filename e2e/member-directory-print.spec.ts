import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Printable Member Directory — docs/work-log/2026-08-07-printable-member-directory.md.
 *
 * Covers the Phase 5 print-verification flows the runner CAN reach: real
 * print-media emulation + real PDF generation via Chromium (Playwright's
 * `page.emulateMedia`/`page.pdf`), not a DOM inspection stand-in. The
 * permission gate itself (session lacking `members.view` redirected to
 * `/access-pending` before any DB query) is covered hermetically in
 * `src/app/members/page.test.ts` and was additionally confirmed against a
 * real zero-role account in a live browser during Phase 5 — see the
 * work-log's Phase 5 section for that one-off verification (creating a
 * disposable zero-role user isn't repeated here every run to avoid
 * accumulating throwaway rows in the dev database on every CI pass).
 */

test.describe("printable member directory", () => {
  test("the print view renders 2 columns with jump-letters and board tags, and the interactive chrome (search box, print button) is hidden under print media", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/members");
    await page.waitForSelector("text=Member Directory");

    // Act
    await page.emulateMedia({ media: "print" });

    // Assert — print roster is present and 2-column
    const printRoot = page.locator(".columns-2");
    await expect(printRoot).toBeVisible();
    const columnCount = await printRoot.evaluate((el) => getComputedStyle(el).columnCount);
    expect(columnCount).toBe("2");

    // Assert — screen-only interactive chrome does not survive into print
    await expect(page.getByPlaceholder(/Search by name/)).toBeHidden();
    await expect(page.getByRole("button", { name: /Print Directory/ })).toBeHidden();
  });

  test("the site's global nav header is hidden under print media — regression for the header rendering above the printed roster on page 1", async ({
    page,
  }) => {
    // Reproduces a bug found during Phase 5 verification: header.tsx's
    // <header> has no `print:hidden` (unlike footer.tsx, which does), so the
    // site's logo/Donate/Admin/Member-Portal/Sign-Out nav bar rendered at
    // the top of the actual generated PDF, ahead of the "Westerville Lions
    // Club / Member Directory" print header — confirmed with a real
    // page.pdf() render during this review.

    // Arrange
    await signInAsAdmin(page);
    await page.goto("/members");
    await page.waitForSelector("text=Member Directory");

    // Act
    await page.emulateMedia({ media: "print" });

    // Assert — the global site header must not render onto the printed page.
    // "Visible" here means visible to Chromium's own print engine: an
    // ancestor's display:none must count too, not just the header's own
    // computed style, so this walks the ancestor chain the same way the
    // browser's print renderer would.
    const headerRenders = await page.evaluate(() => {
      const header = document.querySelector("header");
      if (!header) return false;
      let node: Element | null = header;
      while (node) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        node = node.parentElement;
      }
      return true;
    });
    expect(headerRenders).toBe(false);
  });

  test("printed roster produces a real multi-page PDF via page.pdf() with no console errors", async ({
    page,
  }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/members");
    await page.waitForSelector("text=Member Directory");

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Act
    await page.emulateMedia({ media: "print" });
    const pdfBuffer = await page.pdf({ format: "Letter" });

    // Assert
    expect(pdfBuffer.byteLength).toBeGreaterThan(1000);
    expect(consoleErrors).toEqual([]);
  });
});
