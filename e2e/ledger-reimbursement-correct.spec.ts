import { test, expect, type Page } from "@playwright/test";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  ledgerAuditLog,
  ledgerBankAccounts,
  ledgerBankLines,
  ledgerCategories,
  ledgerEntities,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReconciliationSessions,
  ledgerReimbursements,
  ledgerTransactions,
  members,
  users,
} from "../src/lib/db/schema";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Paid reimbursements are reconcilable and correctable (B-108, DECISION-114) —
 * docs/work-log/2026-10-02-reimbursement-reconcilable.md, Phase 5.
 *
 * Covers the treasurer's flows end to end against the real dev server:
 *   1. The register labels a paid reimbursement "Paid reimbursement.", offers
 *      Correct instead of Edit, and offers "Add bank account" only while the
 *      entry has none.
 *   2. Add bank account (with a check number) makes the entry a match candidate
 *      in an open session on that account; it is matched, the session closes
 *      with a balanced tie-out, and the row is then locked: fill is refused 409,
 *      a date or bank-account correction is refused 403, and the session's
 *      arithmetic does not move.
 *   3. Correct changes the category with a reason and the change shows under
 *      Recent corrections on the Compliance page (the memo text never does).
 *   4. create-from-bank-line on a debit equal to an unmatched paid reimbursement
 *      shows the advisory, "Use that entry instead" opens the repair, "Create &
 *      Match" stays disabled until the box is ticked, and the SERVER refuses
 *      with 409 `possible_duplicate` unless `acknowledgeDuplicate: true`.
 *   5. The route's gate order: 401 unauthenticated, non-uuid 404, an unknown key
 *      400, a row that is not a paid reimbursement 403 `not_correctable`.
 *   6. At 360px both dialogs fit and their primary buttons are reachable.
 *
 * Fixtures: direct DB inserts on the real dev DB (`DATABASE_URL`, never prod).
 * Every party / description starts with "E2E QA Reimb Correct"; the member and
 * user are example.invalid. NEVER drives Mark Paid (it emails the member) and
 * sends no email. cleanup() runs before AND after (audit rows are not cascade-
 * deleted with a transaction, so they are removed by target id first).
 *
 * Serial, single worker: see playwright.config.ts.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const TAG = "E2E QA Reimb Correct";
const SESSION_CSV = "E2E-QA-REIMB-CORRECT";
const MEMBER_EMAIL = "qa-reimb-correct-member@example.invalid";

const FILL_CENTS = 6111;
const DUP_CENTS = 6222;
const CORRECT_CENTS = 6333;
const MOBILE_CENTS = 6444;

const PARTY_FILL = `${TAG} Fill`;
const PARTY_DUP = `${TAG} Duplicate`;
const PARTY_CORRECT = `${TAG} Correct`;
const PARTY_MOBILE = `${TAG} Mobile`;
const PARTY_ORDINARY = `${TAG} Ordinary Row`;
const MEMO_CORRECT = `${TAG} memo that must never be rendered in Recent corrections`;
const REASON_CORRECT = `${TAG}: filed under the wrong category`;
const CHECK_NUMBER = "9171";

const REGISTER_URL = "/admin/ledger/administrative";
const correctUrl = (id: string) => `/api/admin/ledger/transactions/${id}/correct`;

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const monthBounds = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return {
    start: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`,
    end: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(last)}`,
  };
};

interface Ids {
  adminUserId: string;
  clubEntityId: string;
  fundId: string;
  adminBankId: string;
  pettyBankId: string;
  categoryId: string;
  otherCategoryId: string;
  otherCategoryName: string;
  memberId: string;
  memberUserId: string;
  fillTxnId: string;
  dupTxnId: string;
  correctTxnId: string;
  mobileTxnId: string;
  ordinaryTxnId: string;
  fillSessionId: string;
  fillLineId: string;
  dupSessionId: string;
  dupLineId: string;
}
const ids = {} as Ids;

async function one<T>(rows: Promise<T[]>, what: string): Promise<T> {
  const found = (await rows)[0];
  if (!found) throw new Error(`e2e fixture lookup failed: ${what}`);
  return found;
}

/** Removes exactly this suite's rows. Safe to call when nothing exists. */
async function cleanup(): Promise<void> {
  const txns = await db
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(ilike(ledgerTransactions.party, `${TAG}%`));
  const txnIds = txns.map((t) => t.id);
  const sessions = await db
    .select({ id: ledgerReconciliationSessions.id })
    .from(ledgerReconciliationSessions)
    .where(eq(ledgerReconciliationSessions.csvFilename, SESSION_CSV));
  const sessionIds = sessions.map((s) => s.id);

  if (txnIds.length > 0) {
    await db.delete(ledgerAuditLog).where(inArray(ledgerAuditLog.targetTransactionId, txnIds));
  }
  if (sessionIds.length > 0) {
    await db.delete(ledgerReconciliationMatches).where(inArray(ledgerReconciliationMatches.sessionId, sessionIds));
    await db.delete(ledgerBankLines).where(inArray(ledgerBankLines.sessionId, sessionIds));
  }
  await db.delete(ledgerReimbursements).where(ilike(ledgerReimbursements.description, `${TAG}%`));
  await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.party, `${TAG}%`));
  await db.delete(ledgerReconciliationSessions).where(eq(ledgerReconciliationSessions.csvFilename, SESSION_CSV));
  await db.delete(users).where(eq(users.email, MEMBER_EMAIL));
  await db.delete(members).where(eq(members.email, MEMBER_EMAIL));
}

async function seedPaidReimbursement(args: {
  party: string;
  cents: number;
  bankAccountId: string | null;
  memo?: string;
}): Promise<string> {
  const [txn] = await db
    .insert(ledgerTransactions)
    .values({
      entityId: ids.clubEntityId,
      fundId: ids.fundId,
      bankAccountId: args.bankAccountId,
      txnDate: todayIso(),
      flow: "expense",
      categoryId: ids.categoryId,
      amountCents: args.cents,
      party: args.party,
      memo: args.memo ?? `${args.party} memo`,
      paymentMethod: "check",
      receiptStorageKey: "e2e-qa-reimb-correct/placeholder",
      status: "posted",
      approvedByUserId: ids.adminUserId,
      approvedAt: new Date(),
      recordedByUserId: ids.adminUserId,
    })
    .returning({ id: ledgerTransactions.id });
  await db.insert(ledgerReimbursements).values({
    submittedByMemberId: ids.memberId,
    submittedByUserId: ids.memberUserId,
    amountCents: args.cents,
    description: args.party,
    receiptStorageKey: "e2e-qa-reimb-correct/placeholder",
    fundId: ids.fundId,
    status: "paid",
    reviewedByUserId: ids.adminUserId,
    reviewedAt: new Date(),
    paidAt: new Date(),
    ledgerTransactionId: txn.id,
  });
  return txn.id;
}

async function seedSession(args: {
  bankAccountId: string;
  closingCents: number;
  lineCents: number;
  lineDesc: string;
  slip?: string;
}): Promise<{ sessionId: string; lineId: string }> {
  const { start, end } = monthBounds();
  const [session] = await db
    .insert(ledgerReconciliationSessions)
    .values({
      bankAccountId: args.bankAccountId,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      openingBalanceCents: 0,
      closingBalanceCents: args.closingCents,
      status: "open",
      csvFilename: SESSION_CSV,
    })
    .returning({ id: ledgerReconciliationSessions.id });
  const [line] = await db
    .insert(ledgerBankLines)
    .values({
      sessionId: session.id,
      bankAccountId: args.bankAccountId,
      postingDate: todayIso(),
      description: args.lineDesc,
      amountCents: args.lineCents,
      checkOrSlipNumber: args.slip ?? null,
      dedupeKey: `${SESSION_CSV}-${session.id}-${args.lineDesc}`,
    })
    .returning({ id: ledgerBankLines.id });
  return { sessionId: session.id, lineId: line.id };
}

async function seedFixtures(): Promise<void> {
  await cleanup();
  const email = process.env.E2E_ADMIN_EMAIL ?? "";
  ids.adminUserId = (await one(db.select({ id: users.id }).from(users).where(eq(users.email, email)), "e2e admin user")).id;
  const club = await one(db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "club")), "club entity");
  ids.clubEntityId = club.id;
  ids.fundId = (
    await one(
      db.select().from(ledgerFunds).where(and(eq(ledgerFunds.entityId, club.id), eq(ledgerFunds.slug, "administrative"))),
      "administrative fund",
    )
  ).id;
  const bank = async (name: string) =>
    (
      await one(
        db.select().from(ledgerBankAccounts).where(and(eq(ledgerBankAccounts.entityId, club.id), eq(ledgerBankAccounts.name, name))),
        `bank ${name}`,
      )
    ).id;
  ids.adminBankId = await bank("Administrative Checking");
  ids.pettyBankId = await bank("Petty Cash");

  const categories = await db
    .select()
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, club.id),
        eq(ledgerCategories.fundKind, "administrative"),
        eq(ledgerCategories.flow, "expense"),
        eq(ledgerCategories.isActive, true),
      ),
    )
    .orderBy(ledgerCategories.sortOrder, ledgerCategories.name);
  if (categories.length < 2) throw new Error("e2e fixture lookup failed: two active Administrative expense categories");
  ids.categoryId = categories[0].id;
  ids.otherCategoryId = categories[1].id;
  ids.otherCategoryName = categories[1].name;

  const [member] = await db
    .insert(members)
    .values({ firstName: "QA", lastName: "ReimbCorrect", email: MEMBER_EMAIL })
    .returning({ id: members.id });
  ids.memberId = member.id;
  const [memberUser] = await db
    .insert(users)
    .values({ email: MEMBER_EMAIL, memberId: member.id })
    .returning({ id: users.id });
  ids.memberUserId = memberUser.id;

  ids.fillTxnId = await seedPaidReimbursement({ party: PARTY_FILL, cents: FILL_CENTS, bankAccountId: null });
  ids.dupTxnId = await seedPaidReimbursement({ party: PARTY_DUP, cents: DUP_CENTS, bankAccountId: null });
  ids.correctTxnId = await seedPaidReimbursement({
    party: PARTY_CORRECT,
    cents: CORRECT_CENTS,
    bankAccountId: ids.adminBankId,
    memo: MEMO_CORRECT,
  });
  ids.mobileTxnId = await seedPaidReimbursement({ party: PARTY_MOBILE, cents: MOBILE_CENTS, bankAccountId: null });

  // An ordinary (non-reimbursement, unapproved) posted row: not_correctable.
  const [ordinary] = await db
    .insert(ledgerTransactions)
    .values({
      entityId: club.id,
      fundId: ids.fundId,
      bankAccountId: ids.adminBankId,
      txnDate: todayIso(),
      flow: "expense",
      categoryId: ids.categoryId,
      amountCents: 6555,
      party: PARTY_ORDINARY,
      paymentMethod: "check",
      status: "posted",
      recordedByUserId: ids.adminUserId,
    })
    .returning({ id: ledgerTransactions.id });
  ids.ordinaryTxnId = ordinary.id;

  const fill = await seedSession({
    bankAccountId: ids.adminBankId,
    closingCents: -FILL_CENTS,
    lineCents: -FILL_CENTS,
    lineDesc: `${TAG} bank line fill`,
    slip: CHECK_NUMBER,
  });
  ids.fillSessionId = fill.sessionId;
  ids.fillLineId = fill.lineId;
  const dup = await seedSession({
    bankAccountId: ids.pettyBankId,
    closingCents: 0,
    lineCents: -DUP_CENTS,
    lineDesc: `${TAG} bank line duplicate`,
  });
  ids.dupSessionId = dup.sessionId;
  ids.dupLineId = dup.lineId;
}

const dialog = (page: Page, name: RegExp | string) => page.getByRole("dialog", { name });
const registerRow = (page: Page, party: string) => page.locator("tr", { hasText: party });

async function openRegister(page: Page): Promise<void> {
  await page.goto(REGISTER_URL);
  await expect(registerRow(page, PARTY_FILL)).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async () => {
  await seedFixtures();
});

test.afterAll(async () => {
  await cleanup();
});

test.describe("paid reimbursement: label, repair, match, lock", () => {
  test("should label a paid reimbursement, offer Correct instead of Edit, and offer Add bank account only while it has no account", async ({ page }) => {
    await signInAsAdmin(page);
    await openRegister(page);

    const unaccounted = registerRow(page, PARTY_FILL);
    await expect(unaccounted.getByText("Paid reimbursement.")).toBeVisible();
    await expect(unaccounted.getByText(/No bank account/)).toBeVisible();
    await expect(unaccounted.getByRole("button", { name: "Add bank account" })).toBeVisible();
    await expect(unaccounted.getByRole("button", { name: "Correct", exact: true })).toBeEnabled();
    await expect(unaccounted.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);

    const accounted = registerRow(page, PARTY_CORRECT);
    await expect(accounted.getByText("Paid reimbursement.")).toBeVisible();
    await expect(accounted.getByRole("button", { name: "Add bank account" })).toHaveCount(0);
    await expect(accounted.getByRole("button", { name: "Correct", exact: true })).toBeVisible();
  });

  test("should make the repaired entry a match candidate, match it, close the session, and then refuse every change that could move the arithmetic — regression for a paid reimbursement that could never be matched because it had no bank account", async ({ page }) => {
    await signInAsAdmin(page);
    await openRegister(page);

    // Add bank account (default account preselected) with a check number.
    await registerRow(page, PARTY_FILL).getByRole("button", { name: "Add bank account" }).click();
    const add = dialog(page, "Add bank account");
    await expect(add.getByRole("combobox").first()).toHaveValue(ids.adminBankId);
    await add.getByLabel(/Check number/).fill(CHECK_NUMBER);
    await add.getByRole("button", { name: "Add bank account" }).click();
    await expect(add.getByText(/Added to Administrative Checking/)).toBeVisible();

    const afterFill = await one(
      db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.fillTxnId)),
      "filled row",
    );
    expect(afterFill.bankAccountId).toBe(ids.adminBankId);
    expect(afterFill.checkNumber).toBe(CHECK_NUMBER);
    expect(afterFill.approvedAt).not.toBeNull(); // the approval stamp IS the lock
    const audit = await db.select().from(ledgerAuditLog).where(eq(ledgerAuditLog.targetTransactionId, ids.fillTxnId));
    expect(audit.map((a) => a.action)).toEqual(["transaction_corrected"]);

    // The entry is now a candidate in the open session on that account.
    await page.goto(`/admin/ledger/reconciliation/${ids.fillSessionId}`);
    await registerLineMatch(page, "bank line fill");
    const picker = dialog(page, "Match bank line");
    await expect(picker.getByRole("cell", { name: PARTY_FILL, exact: true })).toBeVisible();
    await expect(picker.getByRole("cell", { name: CHECK_NUMBER, exact: true })).toBeVisible();
    await picker.getByRole("checkbox", { name: new RegExp(`Select ${PARTY_FILL}`) }).check();
    await picker.getByRole("button", { name: "Match selected" }).click();
    await expect(page.getByText(/Balanced\./)).toBeVisible({ timeout: 20_000 });

    const sessionBefore = await one(
      db.select().from(ledgerReconciliationSessions).where(eq(ledgerReconciliationSessions.id, ids.fillSessionId)),
      "session",
    );
    await page.getByRole("button", { name: "Close session" }).click();
    await expect
      .poll(async () =>
        (await one(db.select().from(ledgerReconciliationSessions).where(eq(ledgerReconciliationSessions.id, ids.fillSessionId)), "session")).status,
      )
      .toBe("closed");

    // Locked: arithmetic cannot move.
    const preview = await page.request.get(correctUrl(ids.fillTxnId));
    expect(preview.status()).toBe(200);
    const body = await preview.json();
    expect(body.operations.fill_bank_account).toMatchObject({ allowed: false, code: "already_has_bank_account", status: 409 });
    expect(body.operations.correct.dateAndBankEditable).toBe(false);
    expect(body.operations.correct.lockedFields.code).toBe("reconciled_session");
    const token = body.transaction.updatedAt as string;

    const fillAgain = await page.request.post(correctUrl(ids.fillTxnId), {
      data: { operation: "fill_bank_account", bankAccountId: ids.adminBankId, expectedUpdatedAt: token },
    });
    expect(fillAgain.status()).toBe(409);
    const dateChange = await page.request.post(correctUrl(ids.fillTxnId), {
      data: { operation: "correct", reason: `${TAG}: attempted date change`, expectedUpdatedAt: token, txnDate: "2020-01-02" },
    });
    expect(dateChange.status()).toBe(403);
    expect((await dateChange.json()).code).toBe("reconciled_session");
    const bankChange = await page.request.post(correctUrl(ids.fillTxnId), {
      data: { operation: "correct", reason: `${TAG}: attempted account change`, expectedUpdatedAt: token, bankAccountId: ids.pettyBankId },
    });
    expect(bankChange.status()).toBe(403);

    const row = await one(db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.fillTxnId)), "row");
    expect(row.bankAccountId).toBe(ids.adminBankId);
    expect(row.txnDate).toBe(todayIso());
    const sessionAfter = await one(
      db.select().from(ledgerReconciliationSessions).where(eq(ledgerReconciliationSessions.id, ids.fillSessionId)),
      "session",
    );
    expect(sessionAfter.openingBalanceCents).toBe(sessionBefore.openingBalanceCents);
    expect(sessionAfter.closingBalanceCents).toBe(sessionBefore.closingBalanceCents);

    // The register still labels it a paid reimbursement and no longer offers a repair.
    await openRegister(page);
    const locked = registerRow(page, PARTY_FILL);
    await expect(locked.getByText("Paid reimbursement.")).toBeVisible();
    await expect(locked.getByRole("button", { name: "Add bank account" })).toHaveCount(0);
  });
});

test.describe("paid reimbursement: correct and Recent corrections", () => {
  test("should save a category correction only with a change and a reason, and list it under Recent corrections without the memo", async ({ page }) => {
    await signInAsAdmin(page);
    await openRegister(page);

    await registerRow(page, PARTY_CORRECT).getByRole("button", { name: "Correct", exact: true }).click();
    const correct = dialog(page, "Correct paid reimbursement");
    const save = correct.getByRole("button", { name: "Save correction" });
    await expect(save).toBeDisabled(); // nothing changed, no reason

    await correct.getByLabel("Reason").fill(REASON_CORRECT);
    await expect(save).toBeDisabled(); // a reason alone is not a change
    await correct.getByLabel("Category").selectOption({ label: ids.otherCategoryName });
    await expect(save).toBeEnabled();
    await save.click();

    await expect
      .poll(async () =>
        (await one(db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.correctTxnId)), "row")).categoryId,
      )
      .toBe(ids.otherCategoryId);
    const row = await one(db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.correctTxnId)), "row");
    expect(row.approvedAt).not.toBeNull();
    expect(row.bankAccountId).toBe(ids.adminBankId);

    await page.goto("/admin/ledger/compliance");
    await expect(page.getByText("Recent corrections").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`Reason: ${REASON_CORRECT}`)).toBeVisible();
    await expect(page.getByText(/Category: .* to /).first()).toBeVisible();
    await expect(page.getByText("Corrected", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(MEMO_CORRECT)).toHaveCount(0);
  });
});

test.describe("paid reimbursement: create-from-bank-line double-booking guard", () => {
  test("should warn, keep Create & Match disabled until acknowledged, and open the repair via Use that entry instead", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/admin/ledger/reconciliation/${ids.dupSessionId}`);
    const row = page.locator("tr", { hasText: "bank line duplicate" });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: /Create transaction/ }).click();

    const create = dialog(page, /Create transaction from bank line/);
    await expect(create.getByText(/may already be in the register/i)).toBeVisible();
    await expect(create.getByText(/may already record this payment/i)).toBeVisible();
    const createMatch = create.getByRole("button", { name: /Create & Match/ });
    await expect(createMatch).toBeDisabled();
    await create.getByRole("checkbox", { name: /different payment/i }).check();
    await expect(createMatch).toBeEnabled();
    await create.getByRole("checkbox", { name: /different payment/i }).uncheck();

    await create.getByRole("button", { name: /Use that entry instead/ }).first().click();
    const repair = dialog(page, "Add bank account");
    await expect(repair).toBeVisible();
    // The session's account (Petty Cash) is preselected, not the entity default.
    await expect(repair.getByRole("combobox").first()).toHaveValue(ids.pettyBankId);
    await repair.getByRole("button", { name: "Cancel" }).click();

    // Nothing was created by any of that.
    const created = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(
      and(ilike(ledgerTransactions.party, `${TAG}%`), eq(ledgerTransactions.amountCents, DUP_CENTS)),
    );
    expect(created).toHaveLength(1); // only the seeded paid reimbursement
  });

  test("should enforce the guard on the server: 409 possible_duplicate without acknowledgeDuplicate, 400 for a non-boolean flag, nothing inserted — regression for create-from-bank-line double-booking a reimbursement payment", async ({ page }) => {
    await signInAsAdmin(page);
    const url = `/api/admin/ledger/reconciliation/sessions/${ids.dupSessionId}/create-from-bank-line`;
    const base = {
      bankLineId: ids.dupLineId,
      fundId: ids.fundId,
      categoryId: ids.categoryId,
      party: `${TAG} created from bank line`,
      flow: "expense",
      paymentMethod: "check",
    };
    const countRows = async () =>
      (await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(and(ilike(ledgerTransactions.party, `${TAG}%`), eq(ledgerTransactions.amountCents, DUP_CENTS)))).length;
    const before = await countRows();

    const candidates = await page.request.get(`${url}?bankLineId=${ids.dupLineId}`);
    expect(candidates.status()).toBe(200);
    const list = (await candidates.json()).candidates as { transactionId: string; needsBankAccount: boolean; ownRequest: boolean }[];
    expect(list.map((c) => c.transactionId)).toContain(ids.dupTxnId);
    expect(list.find((c) => c.transactionId === ids.dupTxnId)).toMatchObject({ needsBankAccount: true, ownRequest: false });

    const refused = await page.request.post(url, { data: base });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe("possible_duplicate");
    const stringFlag = await page.request.post(url, { data: { ...base, acknowledgeDuplicate: "true" } });
    expect(stringFlag.status()).toBe(400);
    expect(await countRows()).toBe(before);
  });
});

test.describe("paid reimbursement: route gates", () => {
  test("should refuse an unauthenticated call, a non-uuid id, an unknown key and a row that is not a paid reimbursement", async ({ page, playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    const noAuth = await anonymous.post(correctUrl(ids.correctTxnId), { data: { operation: "correct" } });
    expect(noAuth.status()).toBe(401);
    await anonymous.dispose();

    await signInAsAdmin(page);
    const notUuid = await page.request.post(correctUrl("not-a-uuid"), { data: { operation: "correct" } });
    expect(notUuid.status()).toBe(404);

    const preview = await page.request.get(correctUrl(ids.correctTxnId));
    const token = (await preview.json()).transaction.updatedAt as string;
    const unknownKey = await page.request.post(correctUrl(ids.correctTxnId), {
      data: { operation: "correct", reason: `${TAG}: unknown key`, expectedUpdatedAt: token, categoryId: ids.categoryId, amountCents: 1 },
    });
    expect(unknownKey.status()).toBe(400);
    expect((await unknownKey.json()).code).toBe("invalid_body");

    const stampKey = await page.request.post(correctUrl(ids.correctTxnId), {
      data: { operation: "correct", reason: `${TAG}: stamp key`, expectedUpdatedAt: token, approvedAt: null },
    });
    expect(stampKey.status()).toBe(400);

    const notCorrectable = await page.request.post(correctUrl(ids.ordinaryTxnId), {
      data: { operation: "correct", reason: `${TAG}: ordinary row`, expectedUpdatedAt: new Date().toISOString(), memo: "x" },
    });
    expect(notCorrectable.status()).toBe(403);
    expect((await notCorrectable.json()).code).toBe("not_correctable");
    const ordinary = await one(db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, ids.ordinaryTxnId)), "row");
    expect(ordinary.memo).toBeNull();
  });
});

test.describe("paid reimbursement: 360px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("should keep the Add bank account and Correct dialogs inside the viewport with their primary buttons reachable", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(REGISTER_URL);
    const mobileRow = registerRow(page, PARTY_MOBILE);
    await expect(mobileRow).toBeVisible({ timeout: 30_000 });
    await mobileRow.scrollIntoViewIfNeeded();

    await mobileRow.getByRole("button", { name: "Add bank account" }).click();
    const add = dialog(page, "Add bank account");
    await expect(add.getByRole("button", { name: "Add bank account" })).toBeVisible();
    const addBox = await add.boundingBox();
    expect(addBox).not.toBeNull();
    expect(addBox!.x).toBeGreaterThanOrEqual(0);
    expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(360);
    await add.getByRole("button", { name: "Add bank account" }).scrollIntoViewIfNeeded();
    await add.getByRole("button", { name: "Cancel" }).click();

    await mobileRow.getByRole("button", { name: "Correct", exact: true }).click();
    const correct = dialog(page, "Correct paid reimbursement");
    const save = correct.getByRole("button", { name: "Save correction" });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    const saveBox = await save.boundingBox();
    expect(saveBox).not.toBeNull();
    expect(saveBox!.x).toBeGreaterThanOrEqual(0);
    expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(360);
    expect(saveBox!.height).toBeGreaterThanOrEqual(44); // tap target
    const correctBox = await correct.boundingBox();
    expect(correctBox!.x + correctBox!.width).toBeLessThanOrEqual(360);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  });
});

/** Opens the match picker for the bank line whose description contains `fragment`. */
async function registerLineMatch(page: Page, fragment: string): Promise<void> {
  const row = page.locator("tr", { hasText: fragment });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Match", exact: true }).click();
}
