import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Acknowledgment workflow — donor link + Mark Sent reachability
 * (docs/work-log/2026-08-08-acknowledgment-donor-link.md).
 *
 * Reproduces the exact production scenario that stranded the treasurer:
 * he added a donor, recorded an acknowledgment on a real gift, and the
 * donor still showed $0 given (donor_id was written onto
 * ledger_acknowledgments but never onto ledger_transactions, which is what
 * getDonor()/listPendingAcknowledgments() actually key off). Clicking
 * "Record acknowledgment" a second time 409'd with "Use Mark Sent" — but
 * the pending queue had no Mark Sent control anywhere (ack-queue.tsx always
 * rendered "Record acknowledgment" regardless of row state), so the
 * workflow could not be completed from the UI at all.
 *
 * Runs against the Foundation entity's Charitable Fund at a dedicated,
 * never-otherwise-used sentinel fiscal year (FY2096 — 2095/2097/2098/2099
 * are already claimed by sibling suites, per transaction-budget-line-link
 * .spec.ts's own comment) using the real "Public donations" income
 * category, so this suite never touches the treasurer's real gifts/donors.
 * Creates one donor and one transaction through the real UI (matches the
 * black-box discipline established by admin-security.spec.ts and
 * ledger-category-management.spec.ts — no direct DB access from this
 * file) and tears both down via authenticated API calls in afterAll: the
 * donor DELETE clears donor_id off anything that references it, and the
 * transaction DELETE cascades its own ack row (FK ON DELETE CASCADE).
 *
 * Serial — later tests build on the transaction/donor earlier tests create.
 */

test.describe.configure({ mode: "serial" });

const FOUNDATION_ENTITY_SLUG = "foundation";
const CHARITABLE_FUND_SLUG = "charitable";
const TEST_FISCAL_YEAR = 2096;
const TEST_DATE = "2096-08-15";
const TEST_AMOUNT_DISPLAY = "+$500.00";
const RUN_ID = Date.now();
const TXN_PARTY = `QA E2E Ack Payer ${RUN_ID}`;
const DONOR_NAME = `QA E2E Ack Donor ${RUN_ID}`;

const FUND_URL = `/admin/ledger/${CHARITABLE_FUND_SLUG}?entity=${FOUNDATION_ENTITY_SLUG}&fy=${TEST_FISCAL_YEAR}`;
const ACK_QUEUE_URL = "/admin/ledger/donors?tab=acknowledgments";

let page: Page;
let donorId = "";
let txnId = "";

/** The pending-queue row for our test transaction — unique by (date, amount)
 *  within the sentinel FY this suite owns. */
function pendingRow(p: Page) {
  return p.locator("tr", { hasText: TEST_DATE }).filter({ hasText: TEST_AMOUNT_DISPLAY });
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signInAsAdmin(page);
});

test.afterAll(async () => {
  // Teardown via authenticated API calls (shares cookies with `page`).
  // Transaction delete cascades its ack row via FK; donor delete clears
  // donor_id off anything that still references it.
  if (txnId) {
    await page.request.delete(`/api/admin/ledger/transactions/${txnId}`);
  }
  if (donorId) {
    await page.request.delete(`/api/admin/ledger/donors/${donorId}`);
  }
});

test.describe("acknowledgment donor-link + Mark Sent reachability", () => {
  test("creates a donor for the workflow", async () => {
    // Arrange
    await page.goto("/admin/ledger/donors");
    await page.getByRole("button", { name: "Add Donor" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Act
    await dialog.locator("#donor-name").fill(DONOR_NAME);
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/admin/ledger/donors") && res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Add Donor" }).click(),
    ]);

    // Assert
    expect(createRes.ok()).toBe(true);
    const donor = await createRes.json();
    donorId = (donor.donor ?? donor).id;
    expect(donorId).toBeTruthy();
  });

  test("a Foundation income transaction >= $250 with no acknowledgment appears on the pending queue offering Record acknowledgment", async () => {
    // Arrange
    await page.goto(FUND_URL);
    await page.getByRole("button", { name: "Record Transaction" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Act — record a plain Foundation income transaction (Income is the
    // form's default flow mode, no need to click it explicitly).
    await dialog.locator("#txn-amount").fill("500.00");
    await dialog.locator("#txn-date").fill(TEST_DATE);
    await dialog.locator("#txn-category").selectOption({ label: "Public donations" });
    await dialog.locator("#txn-party").fill(TXN_PARTY);
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().endsWith("/api/admin/ledger/transactions") && res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Record Transaction" }).click(),
    ]);

    // Assert
    expect(createRes.ok()).toBe(true);
    const created = await createRes.json();
    txnId = created.id;
    expect(txnId).toBeTruthy();
    expect(created.status).toBe("posted"); // income never requires approval

    await page.goto(ACK_QUEUE_URL);
    const row = pendingRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByText("Pending", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Record acknowledgment" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Mark Sent" })).toHaveCount(0);
  });

  test("recording an acknowledgment with a donor sets the transaction's donor_id — regression for acknowledgment donor-link bug", async () => {
    // Arrange
    await page.goto(ACK_QUEUE_URL);
    const row = pendingRow(page);
    await row.getByRole("button", { name: "Record acknowledgment" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Act — record the acknowledgment, selecting the donor created above.
    await dialog.getByPlaceholder("Search by name or email…").fill(DONOR_NAME);
    await dialog.getByRole("button", { name: DONOR_NAME, exact: true }).click();
    const [ackRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/acknowledge") && res.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Record Acknowledgment" }).click(),
    ]);

    // Assert — 201, and the row's action/status flipped without a reload.
    expect(ackRes.ok()).toBe(true);
    const ack = await ackRes.json();
    expect(ack.donorId).toBe(donorId);

    await expect(row.getByText("Acknowledged — not sent")).toBeVisible();
    await expect(row.getByRole("button", { name: "Mark Sent" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Record acknowledgment" })).toHaveCount(0);

    // Assert — the donor's own giving history now shows this exact gift.
    // This is the treasurer-visible symptom of the bug: before the fix,
    // ledger_transactions.donor_id stayed NULL, so getDonor() (which keys
    // off the TRANSACTION's donor_id, not the acknowledgment's) reported
    // $0 given / 0 transactions despite a real, just-recorded gift.
    await page.goto(`/admin/ledger/donors/${donorId}`);
    await expect(page.getByText("Total Giving")).toBeVisible();
    await expect(page.getByText(TEST_AMOUNT_DISPLAY).first()).toBeVisible();
  });

  test("Mark Sent is reachable from the pending queue and removes the row on completion — regression for dead Mark Sent control", async () => {
    // Arrange
    await page.goto(ACK_QUEUE_URL);
    const row = pendingRow(page);
    await expect(row).toBeVisible();

    // Act — this is the exact step that was previously impossible: the only
    // button ack-queue.tsx ever rendered was "Record acknowledgment", which
    // 409'd for a row that already had an unsent ack, with no other control
    // on this screen to reach Mark Sent.
    await row.getByRole("button", { name: "Mark Sent" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const [markSentRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/acknowledge") && res.request().method() === "PATCH",
      ),
      dialog.getByRole("button", { name: "Mark Sent" }).click(),
    ]);

    // Assert
    expect(markSentRes.ok()).toBe(true);
    const updated = await markSentRes.json();
    expect(updated.sentAt).toBeTruthy();

    await page.goto(ACK_QUEUE_URL);
    await expect(pendingRow(page)).toHaveCount(0);
  });
});
