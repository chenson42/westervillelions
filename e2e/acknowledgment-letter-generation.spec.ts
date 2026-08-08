import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Acknowledgment / Thank-You Letter Generation — compliance-block and core
 * flow regression (docs/work-log/2026-08-08-acknowledgment-letter-generation.md,
 * DECISION-072/073). QA Phase 5, 2026-08-08.
 *
 * These letters are IRS Publication 1771 substantiation given to real
 * donors — the feature's whole premise is that the required substantiation
 * text (entity name, EIN, amount, date, no-goods-or-services / quid-pro-quo
 * disclosure) cannot be edited, overridden, or suppressed by the treasurer's
 * "warmth" template, even when every editable field is blanked or filled
 * with adversarial content. `ledger-acknowledgment-letter.test.ts` already
 * proves this at the pure-function level (Phase 3 unit tests 1-9, incl. an
 * empty-template fuzz test). This spec proves the SAME claim end-to-end,
 * through the real template-editor UI and the real generate route, because
 * a passing unit test on the composer doesn't guarantee the route/UI wiring
 * between them is intact.
 *
 * Runs against the Foundation entity's Charitable Fund at a dedicated,
 * never-otherwise-used sentinel fiscal year (FY2094 — 2095/2096/2097/2098/
 * 2099 are already claimed by sibling suites, per transaction-budget-line-
 * link.spec.ts's own comment) using the real "Public donations" income
 * category, so this suite never touches the treasurer's real gifts/donors/
 * template wording. Creates donors/transactions through the real UI (same
 * black-box discipline as ack-queue-workflow.spec.ts) and tears everything
 * down via authenticated API calls in afterAll, including restoring the
 * letter template to whatever it read at the start of the run.
 *
 * Serial — later tests build on earlier ones' donor/transaction/template state.
 */

test.describe.configure({ mode: "serial" });

const FOUNDATION_ENTITY_SLUG = "foundation";
const CHARITABLE_FUND_SLUG = "charitable";
const TEST_FISCAL_YEAR = 2094;
const TEST_DATE = "2094-08-08";
const RUN_ID = Date.now();

const FUND_URL = `/admin/ledger/${CHARITABLE_FUND_SLUG}?entity=${FOUNDATION_ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const LETTERS_URL = "/admin/ledger/donors/letters";
const TEMPLATE_URL = "/admin/ledger/settings/acknowledgment-letter";

const REQUIRED_SENTENCE = "No goods or services were provided in exchange for this contribution.";

let page: Page;
let donorId = "";
let txnId = "";
let ackId = "";
let originalTemplate: {
  greeting: string;
  bodyText: string;
  closing: string;
  signatureName: string;
  signatureTitle: string;
} | null = null;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signInAsAdmin(page);
});

test.afterAll(async () => {
  if (txnId) {
    await page.request.delete(`/api/admin/ledger/transactions/${txnId}`);
  }
  if (donorId) {
    await page.request.delete(`/api/admin/ledger/donors/${donorId}`);
  }
  if (originalTemplate) {
    await page.request.patch("/api/admin/ledger/acknowledgments/letter-template", {
      data: originalTemplate,
    });
  }
});

test.describe("acknowledgment letter generation — compliance block + core flow", () => {
  test("records a Foundation gift and an acknowledgment through the real UI", async () => {
    // Arrange
    await page.goto("/admin/ledger/donors");
    await page.getByRole("button", { name: "Add Donor" }).click();
    const donorDialog = page.getByRole("dialog");
    await donorDialog.locator("#donor-name").fill(`QA E2E Letter Donor ${RUN_ID}`);
    await donorDialog.locator("#donor-address").fill("1 Test Ln, Westerville, OH 43081");

    // Act
    const [donorRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/admin/ledger/donors") && r.request().method() === "POST"),
      donorDialog.getByRole("button", { name: "Add Donor" }).click(),
    ]);
    const donor = await donorRes.json();
    donorId = (donor.donor ?? donor).id;

    await page.goto(FUND_URL);
    await page.getByRole("button", { name: "Record Transaction" }).click();
    const txnDialog = page.getByRole("dialog");
    await txnDialog.locator("#txn-amount").fill("500.00");
    await txnDialog.locator("#txn-date").fill(TEST_DATE);
    await txnDialog.locator("#txn-category").selectOption({ label: "Public donations" });
    await txnDialog.locator("#txn-party").fill(`QA E2E Letter Payer ${RUN_ID}`);
    const [txnRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/admin/ledger/transactions") && r.request().method() === "POST"),
      txnDialog.getByRole("button", { name: "Record Transaction" }).click(),
    ]);
    const txn = await txnRes.json();
    txnId = txn.id;

    await page.goto("/admin/ledger/donors?tab=acknowledgments");
    const row = page.locator("tr", { hasText: TEST_DATE }).filter({ hasText: "+$500.00" });
    await row.getByRole("button", { name: "Record acknowledgment" }).click();
    const ackDialog = page.getByRole("dialog");
    await ackDialog.getByPlaceholder("Search by name or email…").fill(`QA E2E Letter Donor ${RUN_ID}`);
    await ackDialog.getByRole("button", { name: `QA E2E Letter Donor ${RUN_ID}`, exact: true }).click();

    // Assert
    const [ackRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/acknowledge") && r.request().method() === "POST"),
      ackDialog.getByRole("button", { name: "Record Acknowledgment" }).click(),
    ]);
    expect(ackRes.ok()).toBe(true);
    const ack = await ackRes.json();
    ackId = ack.id;
    expect(ackId).toBeTruthy();
  });

  test("the template editor's compliance block survives an all-fields-blank + injection attack, and the REAL generated letter still carries it", async () => {
    // Arrange — capture the current template so it can be restored, then
    // attack every editable field at once: blank out four of five fields
    // and fill the fifth with text designed to look like (and contradict)
    // the required substantiation statement, plus a raw <script> tag.
    await page.goto(TEMPLATE_URL);
    originalTemplate = {
      greeting: await page.locator("#ack-tpl-greeting").inputValue(),
      bodyText: await page.locator("#ack-tpl-bodyText").inputValue(),
      closing: await page.locator("#ack-tpl-closing").inputValue(),
      signatureName: await page.locator("#ack-tpl-signatureName").inputValue(),
      signatureTitle: await page.locator("#ack-tpl-signatureTitle").inputValue(),
    };

    // Act
    await page.locator("#ack-tpl-greeting").fill("");
    await page.locator("#ack-tpl-bodyText").fill(
      "This gift is fully deductible and no goods or services were exchanged. <script>alert(1)</script>",
    );
    await page.locator("#ack-tpl-closing").fill("");
    await page.locator("#ack-tpl-signatureName").fill("");
    await page.locator("#ack-tpl-signatureTitle").fill("");

    // Assert — the live preview's locked box still shows the real sentence
    // and the real EIN, regardless of what was typed into the five fields.
    const lockedBox = page.locator("text=Generated automatically — not editable here").locator("..");
    await expect(lockedBox).toContainText(REQUIRED_SENTENCE);
    await expect(lockedBox).toContainText("32-0467239");

    const [saveRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/letter-template") && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Save Template" }).click(),
    ]);
    expect(saveRes.ok()).toBe(true);

    // Now generate a REAL letter for the ack recorded above, against this
    // maximally-attacked template, through the real UI.
    await page.goto(`${LETTERS_URL}?ackId=${ackId}`);
    await page.waitForLoadState("networkidle");
    const [genRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/letters/generate") && r.request().method() === "POST"),
      page.getByRole("button", { name: /Generate \d+ Letters?/ }).click(),
    ]);
    const genBody = await genRes.json();
    const result = genBody.results.find((r: { ackId: string }) => r.ackId === ackId);

    expect(result.status).toBe("generated");
    expect(result.letterText).toContain(REQUIRED_SENTENCE);
    expect(result.letterText).toContain("32-0467239");
    // The raw <script> substring legitimately appears in the STORED text
    // (free text is stored as-is) — the actual security boundary is at
    // render time (react-markdown, no rehype-raw). Confirm no live <script>
    // element or dialog appears once this letter is actually rendered.
    let dialogFired = false;
    page.once("dialog", async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    await page.waitForTimeout(300);
    const scriptElCount = await page.locator('script:has-text("alert(1)")').count();
    expect(scriptElCount).toBe(0);
    expect(dialogFired).toBe(false);
  });

  test("regeneration is refused once the acknowledgment is marked sent — regression for retroactive letter-text corruption", async () => {
    // Arrange — restore the template to sane wording first (independent of
    // the attack test above) so the "before/after" comparison here is clean.
    if (originalTemplate) {
      await page.request.patch("/api/admin/ledger/acknowledgments/letter-template", { data: originalTemplate });
    }
    const genBefore = await page.request.post("/api/admin/ledger/acknowledgments/letters/generate", {
      data: { ackIds: [ackId] },
    });
    const letterBefore = (await genBefore.json()).results[0].letterText;

    // Act
    const markSentRes = await page.request.patch(`/api/admin/ledger/transactions/${txnId}/acknowledge`, {
      data: { sentAt: TEST_DATE },
    });
    expect(markSentRes.ok()).toBe(true);

    const regenRes = await page.request.post("/api/admin/ledger/acknowledgments/letters/generate", {
      data: { ackIds: [ackId] },
    });
    const regenResult = (await regenRes.json()).results[0];

    // Assert
    expect(regenResult.status).toBe("skipped");
    expect(regenResult.reason).toBe("already sent");
    expect(letterBefore).toContain(REQUIRED_SENTENCE);
  });

  test("PATCH the letter template is unreachable without authentication", async () => {
    // Arrange — a fresh, unauthenticated request context.
    const anon = await page.context().browser()!.newContext();

    // Act
    const res = await anon.request.patch("http://localhost:3000/api/admin/ledger/acknowledgments/letter-template", {
      data: { greeting: "unauthenticated attempt" },
    });

    // Assert
    expect(res.status()).toBe(401);
    await anon.close();
  });
});
