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
import {
  loadXmIds,
  seedEmptyClosedSession,
  seedFoundationGift,
  seedSessionWithMatch,
  todayIso as xmTodayIso,
  type SeededGift,
  type XmIds,
} from "./helpers/cross-entity-move-fixtures";

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
 * The second describe block covers the CROSS-ENTITY move (DECISION-112/113,
 * docs/work-log/2026-10-01-cross-entity-transaction-move.md): a Foundation gift
 * whose cash landed in the Club's account moves to the Club's Activity Fund with
 * its donor and its already-sent receipt, behind a required Club bank-account
 * pick; a gift cleared by a closed reconciliation session gets a guided
 * checklist instead of a form. Fixtures are in helpers/cross-entity-move-fixtures.ts
 * (example.com donors only). The sweep form is opened but never submitted.
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


// ---------------------------------------------------------------------------
// Cross-entity move: Foundation Charitable -> Club Activity (DECISION-112/113)
// ---------------------------------------------------------------------------

const FOUNDATION_REGISTER = "/admin/ledger/charitable?entity=foundation";
const REASON_CROSS = `${TAG}: gift was deposited in the Club's account`;

test.describe("Move a Foundation gift to the Club (cross-entity)", () => {
  let xm: XmIds;
  let sentGift: SeededGift;
  let closedGift: SeededGift;
  let closedSession: { sessionId: string; bankLineId: string; matchId: string };
  let laterSessionId: string;
  let mobileGift: SeededGift;
  let clubAdminTxnId: string;
  const PARTY_CLUB_ADMIN = `${TAG} Club Admin Income`;

  test.beforeAll(async () => {
    await cleanupMoveTransactionFixtures();
    xm = await loadXmIds();
    sentGift = await seedFoundationGift(xm, { party: "Cross Sent Receipt", ack: "sent" });
    mobileGift = await seedFoundationGift(xm, { party: "Cross Mobile", ack: "sent" });
    // Cleared by a closed August session, with a later closed September session on the same account.
    closedGift = await seedFoundationGift(xm, { party: "Cross Closed Session", ack: "sent", txnDate: "2026-08-15" });
    closedSession = await seedSessionWithMatch({
      ids: xm,
      txnId: closedGift.txnId,
      amountCents: 5000,
      bankAccountId: xm.foundationBankId,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "closed",
    });
    laterSessionId = await seedEmptyClosedSession(xm.foundationBankId, "2026-09-01", "2026-09-30");
    clubAdminTxnId = (
      await db
        .insert(ledgerTransactions)
        .values({
          entityId: xm.clubEntityId,
          fundId: xm.adminFundId,
          bankAccountId: xm.adminBankId,
          txnDate: xmTodayIso(),
          flow: "income",
          categoryId: xm.clubActivityPublicDonationsId,
          amountCents: 3100,
          party: PARTY_CLUB_ADMIN,
          paymentMethod: "cash",
          status: "posted",
          recordedByUserId: xm.adminUserId,
        })
        .returning({ id: ledgerTransactions.id })
    )[0].id;
  });

  test.afterAll(async () => {
    await cleanupMoveTransactionFixtures();
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  async function openFoundationMove(page: Page, party: string) {
    await page.goto(FOUNDATION_REGISTER);
    await page.locator("tr", { hasText: party }).getByRole("button", { name: "Move", exact: true }).click();
    return page.getByRole("dialog");
  }

  async function pickActivityDestination(dialog: ReturnType<Page["getByRole"]>) {
    const dest = dialog.locator("#move-dest");
    const options = await dest.locator("option").evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, text: e.textContent ?? "" })),
    );
    await dest.selectOption(options.find((o) => /Activity/.test(o.text))!.value);
  }

  async function pickClubAccount(dialog: ReturnType<Page["getByRole"]>, name: string) {
    const bank = dialog.locator("#move-bank");
    const options = await bank.locator("option").evaluateAll((els) =>
      els.map((e) => ({ value: (e as HTMLOptionElement).value, text: e.textContent ?? "" })),
    );
    await bank.selectOption(options.find((o) => o.text.startsWith(name))!.value);
  }

  test("should move a Foundation gift with a sent receipt to the Club's Activity Fund, keep the donor and the receipt, and require the Club bank account", async ({ page }) => {
    // Arrange
    const [ackBefore] = await db.select().from(ledgerAcknowledgments).where(eq(ledgerAcknowledgments.donationTxnId, sentGift.txnId));
    const dialog = await openFoundationMove(page, sentGift.party);
    await dialog.getByText("What will change").waitFor();
    await pickActivityDestination(dialog);
    const confirm = dialog.getByRole("button", { name: /^Move to/ });

    // Assert: the account is an explicit pick, both accounts change, and the same-entity "unchanged" line is absent
    await expect(dialog.locator("#move-bank")).toHaveValue("");
    await dialog.locator("#move-reason").fill(REASON_CROSS);
    await expect(confirm).toBeDisabled();
    await pickClubAccount(dialog, "Administrative Checking");
    await expect(confirm).toBeEnabled();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(text).toContain("Foundation Checking");
    expect(text).toContain("Administrative Checking");
    expect(text).toContain("cannot be moved back");
    expect(text).not.toMatch(/Bank account balance:\s*unchanged/i);

    // Act
    await confirm.click();
    await expect(dialog.getByRole("status")).toContainText("Moved to Activity Fund (Club)");

    // Assert: the row is now the Club's, on the picked account, with donor and receipt intact
    const [moved] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, sentGift.txnId));
    expect([moved.entityId, moved.fundId, moved.bankAccountId, moved.donorId]).toEqual([
      xm.clubEntityId,
      xm.activityFundId,
      xm.adminBankId,
      sentGift.donorId,
    ]);
    const [ackAfter] = await db.select().from(ledgerAcknowledgments).where(eq(ledgerAcknowledgments.donationTxnId, sentGift.txnId));
    expect(ackAfter.sentAt?.getTime()).toBe(ackBefore.sentAt?.getTime());
    expect(ackAfter.sentVia).toBe(ackBefore.sentVia);
    expect(ackAfter.letterText).toBe(ackBefore.letterText);
    expect(ackAfter.doneeEntityId).toBe(xm.foundationEntityId);
    await expect(dialog.getByRole("status")).toContainText("receipt letter stays attached");
  });

  test("should open the sweep form on the Club's register with the board minute empty — regression for the deep link taking the register's entity slug", async ({ page }) => {
    // Arrange: the success step of a move is gone after a reload, so open the sweep deep link the dialog builds
    await page.goto(`/admin/ledger/activity?entity=club&sweepFrom=${sentGift.txnId}`);
    const sweep = page.getByRole("dialog");
    await sweep.getByText("Record Sweep").first().waitFor();

    // Assert: prefilled from the moved gift, the minute is never guessed, and the memo names the Foundation
    await expect(sweep.locator("#txn-amount")).toHaveValue("50.00");
    await expect(sweep.locator("#txn-board-minute")).toHaveValue("");
    await expect(sweep.locator("#txn-from-account option:checked")).toContainText("Administrative Checking");
    expect(await sweep.locator("#txn-memo").inputValue()).toContain("moved from the Foundation");
    const sweepRows = await db.select().from(ledgerTransactions).where(ilike(ledgerTransactions.memo, `Sweep of ${TAG}%`));
    expect(sweepRows).toHaveLength(0);
  });

  test("should name the Foundation as the receipt's issuer on the Club register and refuse to delete the moved gift — regression for a moved receipt losing its issuer", async ({ page }) => {
    // Act
    await page.goto("/admin/ledger/activity?entity=club");
    const clubRow = page.locator("tr", { hasText: sentGift.party });
    await expect(clubRow).toBeVisible();
    const del = await page.request.delete(`/api/admin/ledger/transactions/${sentGift.txnId}`, {
      data: { reason: `${TAG}: attempt to delete a receipted gift (must be refused)` },
    });

    // Assert
    await expect(clubRow).toContainText("Receipt on file, issued by the Foundation");
    expect(del.status()).toBe(409);
    expect((await del.json()).code).toBe("receipt_sent");
    const acks = await db.select().from(ledgerAcknowledgments).where(eq(ledgerAcknowledgments.donationTxnId, sentGift.txnId));
    expect(acks).toHaveLength(1);
  });

  test("should list the move on both entities' Recent corrections as Foundation to Club with the receipt already sent", async ({ page }) => {
    for (const entity of ["club", "foundation"]) {
      // Act
      await page.goto(`/admin/ledger/compliance?entity=${entity}`);
      await page.getByRole("heading", { name: "Recent corrections" }).waitFor();
      const section = (await page.locator("section", { hasText: "Recent corrections" }).innerText()).replace(/\s+/g, " ");

      // Assert
      expect(section).toContain("Foundation to Club");
      expect(section).toContain("Receipt already sent");
      expect(section).toContain(REASON_CROSS);
      expect(section).toContain("Foundation Checking to Administrative Checking");
    }
  });

  test("should show a checklist with the later closed session first and no form for a gift cleared by a closed session, then offer the form after reopen and unmatch", async ({ page }) => {
    // Act: the register offers Move on a closed-session Foundation row and the dialog guides instead of asking
    await page.goto(FOUNDATION_REGISTER);
    const row = page.locator("tr", { hasText: closedGift.party });
    await expect(row).toContainText("If the money is in the Club");
    await row.getByRole("button", { name: "Move", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Before this can move").waitFor();
    const text = (await dialog.innerText()).replace(/\s+/g, " ");

    // Assert: names the session and the later one first, says what reopening does, and renders no form
    expect(text).toContain("Foundation Checking reconciliation session");
    expect(text).toContain("Reopen Sep 1 to Sep 30, 2026 first");
    expect(text).toContain("hidden from members until you close the session again");
    expect(await dialog.locator("#move-reason").count()).toBe(0);
    expect(await dialog.locator("#move-bank").count()).toBe(0);
    await expect(dialog.getByRole("link", { name: /Sep 1 to Sep 30, 2026/ })).toHaveAttribute("href", `/admin/ledger/reconciliation/${laterSessionId}`);
    const refused = await page.request.post(`/api/admin/ledger/transactions/${closedGift.txnId}/move`, {
      data: {
        destFundId: xm.activityFundId,
        categoryId: null,
        reason: `${TAG}: must be refused while the session is closed`,
        expectedFundId: xm.charitableFundId,
        destBankAccountId: xm.adminBankId,
      },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe("reconciled_session");

    // Act: reopen newest first, then unmatch (the real routes the checklist links to)
    expect((await page.request.post(`/api/admin/ledger/reconciliation/sessions/${laterSessionId}/reopen`)).status()).toBe(200);
    expect((await page.request.post(`/api/admin/ledger/reconciliation/sessions/${closedSession.sessionId}/reopen`)).status()).toBe(200);
    expect((await page.request.delete(`/api/admin/ledger/reconciliation/sessions/${closedSession.sessionId}/match/${closedSession.matchId}`)).status()).toBe(200);
    await dialog.getByRole("button", { name: "Check again" }).click();

    // Assert: the checklist gives way to the form, and the row is untouched until Confirm
    await dialog.getByText("What will change").waitFor();
    await expect(dialog.locator("#move-bank")).toBeVisible();
    const [stillFoundation] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, closedGift.txnId));
    expect(stillFoundation.entityId).toBe(xm.foundationEntityId);
  });

  test("should list the Foundation's Charitable Fund as not allowed on a Club Administrative income row, and point the Delete dialog at the Foundation's register", async ({ page }) => {
    // Arrange
    await page.goto("/admin/ledger/administrative?entity=club");
    const row = page.locator("tr", { hasText: PARTY_CLUB_ADMIN });

    // Act
    await row.getByRole("button", { name: "Move", exact: true }).click();
    const moveDialog = page.getByRole("dialog");
    await moveDialog.getByText("What will change").waitFor();
    const moveText = (await moveDialog.innerText()).replace(/\s+/g, " ");
    await moveDialog.getByRole("button", { name: "Cancel" }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    const deleteText = (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ");

    // Assert
    expect(moveText).toContain("A Club entry cannot be moved onto the Foundation's books");
    expect(deleteText).toMatch(/If this gift['’]s money is actually in the Foundation['’]s bank account/);
    const [untouched] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, clubAdminTxnId));
    expect(untouched.entityId).toBe(xm.clubEntityId);
  });

  test("should keep the cross-entity form inside a 360px viewport with the bank account and reason reachable", async ({ page }) => {
    // Arrange
    await page.setViewportSize({ width: 360, height: 740 });
    const dialog = await openFoundationMove(page, mobileGift.party);
    await dialog.getByText("What will change").waitFor();
    await pickActivityDestination(dialog);
    await pickClubAccount(dialog, "Administrative Checking");

    // Act
    await dialog.locator("#move-reason").scrollIntoViewIfNeeded();
    await dialog.locator("#move-reason").fill(`${TAG}: mobile layout check`);
    const fit = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') as HTMLElement;
      return {
        dialogScroll: d.scrollWidth,
        dialogClient: d.clientWidth,
        docScroll: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

    // Assert
    expect(fit.dialogScroll).toBeLessThanOrEqual(fit.dialogClient + 1);
    expect(fit.docScroll).toBeLessThanOrEqual(fit.innerWidth + 1);
    await expect(dialog.locator("#move-bank")).toBeVisible();
    await expect(dialog.locator("#move-reason")).toBeVisible();
  });
});
