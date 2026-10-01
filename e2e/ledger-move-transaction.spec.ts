import { test, expect, type Page } from "@playwright/test";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  ledgerAcknowledgments,
  ledgerBankAccounts,
  ledgerCategories,
  ledgerEntities,
  ledgerFunds,
  ledgerReconciliationSessions,
  ledgerTransactions,
  users,
} from "../src/lib/db/schema";
import { signInAsAdmin } from "./helpers/auth";
import {
  MOVE_FIXTURE_SESSION_CSV,
  MOVE_FIXTURE_TAG,
  cleanupMoveTransactionFixtures,
} from "./helpers/ledger-fixture-cleanup";

/**
 * Move a posted income row to another fund, and the hardened Delete
 * (DECISION-109/110/111) —
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md, Phase 5.
 *
 * The treasurer's flow: an Administrative-fund income row that is really
 * public money is moved to the Activity Fund (reason required, ratchet and
 * "bank balance unchanged" shown), then "Record sweep now" deep-links to the
 * sweep form prefilled but with the board-minute reference empty. The
 * correction then shows on the Compliance page. Also covers the lock label on a
 * row cleared by a closed reconciliation session, the reconcile-toggle
 * refusal on that row, PATCH `fundId` -> 400, and a delete refused with 409
 * when the donor's receipt was already sent.
 *
 * Fixtures: direct DB inserts on the real dev DB (`DATABASE_URL`, never prod).
 * Every party starts with "E2E QA Move" and every correction reason contains
 * the same tag, so cleanupMoveTransactionFixtures() removes exactly this
 * suite's transactions, session and audit rows (audit rows are NOT cascade-
 * deleted with a transaction). The sweep form is opened but never submitted,
 * so no sweep rows or email are ever created.
 *
 * Serial, single worker — see playwright.config.ts.
 */

test.describe.configure({ mode: "serial" });

const TAG = MOVE_FIXTURE_TAG;
const PARTY_MOVE = `${TAG} Gift`;
const PARTY_LOCKED = `${TAG} Locked Row`;
const PARTY_DELETE = `${TAG} Delete Row`;
const PARTY_MOBILE = `${TAG} Mobile Row`;
const PARTY_FOUNDATION = `${TAG} Foundation Donor`;
const REASON_MOVE = `${TAG}: gift was deposited under the wrong fund`;
const REASON_DELETE = `${TAG}: duplicate entry removed`;
const SWEEP_AMOUNT_CENTS = 5000;

const todayIso = () => new Date().toISOString().slice(0, 10);

interface Ids {
  adminUserId: string;
  clubEntityId: string;
  foundationEntityId: string;
  adminFundId: string;
  activityFundId: string;
  charitableFundId: string;
  adminBankId: string;
  foundationBankId: string;
  adminIncomeCategoryId: string;
  charitableIncomeCategoryId: string;
  movedTxnId: string;
  lockedTxnId: string;
  foundationDonationId: string;
}
const ids = {} as Ids;

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

async function seedFixtures() {
  const email = process.env.E2E_ADMIN_EMAIL ?? "";
  ids.adminUserId = (await one(db.select({ id: users.id }).from(users).where(eq(users.email, email)), "e2e admin user")).id;

  const club = await one(db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "club")), "club entity");
  const foundation = await one(db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "foundation")), "foundation entity");
  ids.clubEntityId = club.id;
  ids.foundationEntityId = foundation.id;

  const fund = async (entityId: string, slug: string) =>
    (await one(db.select().from(ledgerFunds).where(and(eq(ledgerFunds.entityId, entityId), eq(ledgerFunds.slug, slug))), `fund ${slug}`)).id;
  ids.adminFundId = await fund(club.id, "administrative");
  ids.activityFundId = await fund(club.id, "activity");
  ids.charitableFundId = await fund(foundation.id, "charitable");

  const bank = async (entityId: string, name: string) =>
    (await one(db.select().from(ledgerBankAccounts).where(and(eq(ledgerBankAccounts.entityId, entityId), eq(ledgerBankAccounts.name, name))), `bank ${name}`)).id;
  ids.adminBankId = await bank(club.id, "Administrative Checking");
  ids.foundationBankId = await bank(foundation.id, "Foundation Checking");

  const category = async (entityId: string, fundKind: string, name: string) =>
    (
      await one(
        db
          .select()
          .from(ledgerCategories)
          .where(and(eq(ledgerCategories.entityId, entityId), eq(ledgerCategories.fundKind, fundKind), eq(ledgerCategories.flow, "income"), eq(ledgerCategories.name, name))),
        `category ${name}`,
      )
    ).id;
  ids.adminIncomeCategoryId = await category(club.id, "administrative", "Misc");
  ids.charitableIncomeCategoryId = await category(foundation.id, "charitable", "Public donations");

  const income = (party: string, extra: Partial<typeof ledgerTransactions.$inferInsert> = {}) =>
    db
      .insert(ledgerTransactions)
      .values({
        entityId: club.id,
        fundId: ids.adminFundId,
        bankAccountId: ids.adminBankId,
        txnDate: todayIso(),
        flow: "income",
        categoryId: ids.adminIncomeCategoryId,
        amountCents: SWEEP_AMOUNT_CENTS,
        party,
        paymentMethod: "cash",
        status: "posted",
        recordedByUserId: ids.adminUserId,
        ...extra,
      })
      .returning({ id: ledgerTransactions.id });

  ids.movedTxnId = (await income(PARTY_MOVE))[0].id;
  await income(PARTY_DELETE, { amountCents: 1234 });
  await income(PARTY_MOBILE, { amountCents: 2345 });

  const session = (
    await db
      .insert(ledgerReconciliationSessions)
      .values({
        bankAccountId: ids.adminBankId,
        statementPeriodStart: "2026-09-01",
        statementPeriodEnd: "2026-09-30",
        openingBalanceCents: 0,
        closingBalanceCents: 0,
        status: "closed",
        csvFilename: MOVE_FIXTURE_SESSION_CSV,
        closedAt: new Date(),
      })
      .returning({ id: ledgerReconciliationSessions.id })
  )[0];
  ids.lockedTxnId = (
    await income(PARTY_LOCKED, { amountCents: 2500, reconciled: true, reconciledSessionId: session.id })
  )[0].id;

  // Foundation donation whose acknowledgment was already SENT to the donor.
  ids.foundationDonationId = (
    await db
      .insert(ledgerTransactions)
      .values({
        entityId: foundation.id,
        fundId: ids.charitableFundId,
        bankAccountId: ids.foundationBankId,
        txnDate: todayIso(),
        flow: "income",
        categoryId: ids.charitableIncomeCategoryId,
        amountCents: 7777,
        party: PARTY_FOUNDATION,
        paymentMethod: "check",
        status: "posted",
        recordedByUserId: ids.adminUserId,
      })
      .returning({ id: ledgerTransactions.id })
  )[0].id;
  await db.insert(ledgerAcknowledgments).values({
    donationTxnId: ids.foundationDonationId,
    amountCents: 7777,
    txnDate: todayIso(),
    type: "written_ack_250",
    sentAt: new Date(),
    sentVia: "email",
  });
}

async function openRegister(page: Page, fundSlug: string) {
  await page.goto(`/admin/ledger/${fundSlug}?entity=club`);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

test.describe("Move a transaction to another fund", () => {
  test.beforeAll(async () => {
    await cleanupMoveTransactionFixtures();
    await seedFixtures();
  });

  test.afterAll(async () => {
    await cleanupMoveTransactionFixtures();
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("should move an Administrative income row to the Activity Fund and open the sweep form with the board minute left empty", async ({ page }) => {
    // Arrange
    await openRegister(page, "administrative");
    const row = page.locator("tr", { hasText: PARTY_MOVE });

    // Act: open the dialog and read the preview
    await row.getByRole("button", { name: "Move", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("What will change").waitFor();

    // Assert: preview states the ratchet and that no bank balance changes
    await expect(dialog).toContainText("cannot be moved back");
    await expect(dialog).toContainText(/Administrative Checking balance:\s*unchanged/);
    await expect(dialog.locator("#move-category option:checked")).toHaveText("Public donations");

    // Act: confirm is blocked until a reason is typed
    const confirm = dialog.getByRole("button", { name: /^Move to/ });
    await expect(confirm).toBeDisabled();
    await dialog.locator("#move-reason").fill(REASON_MOVE);
    await confirm.click();
    await expect(dialog.getByText("Moved to Activity Fund.")).toBeVisible();

    // Assert: the row is now in Activity, not Administrative
    const [moved] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.movedTxnId));
    expect(moved.fundId).toBe(ids.activityFundId);
    expect(moved.bankAccountId).toBe(ids.adminBankId);

    // Act: follow the deep link
    await dialog.getByRole("link", { name: "Record sweep now" }).click();
    await page.waitForURL(/\/admin\/ledger\/activity.*sweepFrom=/);
    const sweep = page.getByRole("dialog");
    await sweep.getByText("Record Sweep").first().waitFor();

    // Assert: prefilled, but the board-minute reference is never guessed
    await expect(sweep.locator("#txn-amount")).toHaveValue("50.00");
    await expect(sweep.locator("#txn-board-minute")).toHaveValue("");
    await expect(sweep.locator("#txn-from-account option:checked")).toContainText("Administrative Checking");
    const sweepRows = await db.select().from(ledgerTransactions).where(ilike(ledgerTransactions.memo, `Sweep of ${PARTY_MOVE}%`));
    expect(sweepRows).toHaveLength(0);
  });

  test("should list the move with its reason on the Club compliance page and not on the Foundation's", async ({ page }) => {
    // Act
    await page.goto("/admin/ledger/compliance?entity=club");
    await page.getByRole("heading", { name: "Recent corrections" }).waitFor();
    const club = await page.locator("section", { hasText: "Recent corrections" }).innerText();
    await page.goto("/admin/ledger/compliance?entity=foundation");
    await page.getByRole("heading", { name: "Recent corrections" }).waitFor();
    const foundation = await page.locator("section", { hasText: "Recent corrections" }).innerText();

    // Assert
    expect(club).toContain(REASON_MOVE);
    expect(club).toContain("Administrative Fund to Activity Fund");
    expect(foundation).not.toContain(REASON_MOVE);
  });

  test("should show a lock label and disabled Edit and Delete on a row cleared by a closed reconciliation session", async ({ page }) => {
    // Arrange
    await openRegister(page, "administrative");
    const row = page.locator("tr", { hasText: PARTY_LOCKED });

    // Assert
    await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
    await expect(row).toContainText("Reconciled.");
  });

  test("should refuse to un-reconcile a row owned by a closed session and keep its session pointer — regression for the reconcile-toggle lock bypass", async ({ page }) => {
    // Act
    const off = await page.request.post(`/api/admin/ledger/transactions/${ids.lockedTxnId}/reconcile`, { data: { reconciled: false } });
    const on = await page.request.post(`/api/admin/ledger/transactions/${ids.lockedTxnId}/reconcile`, { data: { reconciled: true } });

    // Assert
    expect(off.status()).toBe(403);
    expect(on.status()).toBe(403);
    const [row] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.lockedTxnId));
    expect(row.reconciled).toBe(true);
    expect(row.reconciledSessionId).not.toBeNull();
  });

  test("should answer 400 when an ordinary edit tries to change the fund", async ({ page }) => {
    // Act
    const res = await page.request.patch(`/api/admin/ledger/transactions/${ids.lockedTxnId}`, { data: { fundId: ids.activityFundId } });

    // Assert
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Use Move to another fund.");
  });

  test("should refuse to delete a donation whose receipt was already sent and keep both rows — regression for sent-acknowledgment cascade loss", async ({ page }) => {
    // Act
    const res = await page.request.delete(`/api/admin/ledger/transactions/${ids.foundationDonationId}`, {
      data: { reason: `${REASON_DELETE} (must be refused)` },
    });

    // Assert
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("receipt_sent");
    const txn = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.foundationDonationId));
    const acks = await db.select().from(ledgerAcknowledgments).where(eq(ledgerAcknowledgments.donationTxnId, ids.foundationDonationId));
    expect(txn).toHaveLength(1);
    expect(acks).toHaveLength(1);
    expect(acks[0].sentAt).not.toBeNull();
  });

  test("should delete an ordinary row through the dialog with a reason and list it as Deleted on the compliance page", async ({ page }) => {
    // Arrange
    await openRegister(page, "administrative");
    const row = page.locator("tr", { hasText: PARTY_DELETE });

    // Act
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Delete", exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.locator("#delete-reason").fill(REASON_DELETE);
    await confirm.click();
    await expect(page.locator("tr", { hasText: PARTY_DELETE })).toHaveCount(0);
    await page.goto("/admin/ledger/compliance?entity=club");
    const section = await page.locator("section", { hasText: "Recent corrections" }).innerText();

    // Assert
    expect(section).toContain("Deleted");
    expect(section).toContain(REASON_DELETE);
  });

  test("should keep the Move dialog inside a 360px viewport", async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width: 360, height: 740 });
    await openRegister(page, "administrative");

    // Act
    await page.locator("tr", { hasText: PARTY_MOBILE }).getByRole("button", { name: "Move", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("What will change").waitFor();
    const fit = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') as HTMLElement;
      return { dialogScroll: d.scrollWidth, dialogClient: d.clientWidth };
    });

    // Assert
    expect(fit.dialogScroll).toBeLessThanOrEqual(fit.dialogClient + 1);
  });
});
