/**
 * Shared category-versus-fund and bank-account-versus-entity validation for
 * ledger transactions (DECISION-109, architect R8 duplication rule).
 *
 * The category-vs-fund-kind-and-flow check already exists as three inline
 * copies (transactions POST, its handleTransfer sweep branch, and PATCH); the
 * fund move would be a fourth, so it uses this module instead. In THIS change
 * only the move route uses `validateCategoryForFund`, and only the new
 * bank-account checks use `validateBankAccountForEntity`; migrating the three
 * existing category sites is B-94(a).
 *
 * The pure `check*` functions are table-tested; the `validate*` wrappers only
 * load the row.
 */

import { eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ledgerCategories, ledgerBankAccounts } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils";

/** `db` or a transaction handle. */
export type SelectExecutor = Pick<typeof db, "select">;

export type FitFailure = { ok: false; status: 400 | 404; code: string; error: string };

export interface CategoryFitRow {
  id: string;
  entityId: string;
  fundKind: string;
  flow: string;
  isActive: boolean;
  name?: string;
}

export function checkCategoryFit(
  cat: CategoryFitRow | undefined,
  fund: { entityId: string; kind: string },
  flow: string,
  opts: { requireActive?: boolean } = {},
): { ok: true } | FitFailure {
  if (!cat) {
    return { ok: false, status: 404, code: "category_not_found", error: "Category not found" };
  }
  if (cat.entityId !== fund.entityId) {
    return {
      ok: false,
      status: 400,
      code: "category_invalid",
      error: "Category does not belong to this entity",
    };
  }
  if (cat.fundKind !== fund.kind) {
    return {
      ok: false,
      status: 400,
      code: "category_invalid",
      error: "Category does not match fund type",
    };
  }
  if (cat.flow !== flow) {
    return {
      ok: false,
      status: 400,
      code: "category_invalid",
      error: "Category flow does not match transaction flow",
    };
  }
  if (opts.requireActive && !cat.isActive) {
    return {
      ok: false,
      status: 400,
      code: "category_invalid",
      error: "Category is no longer active",
    };
  }
  return { ok: true };
}

export async function validateCategoryForFund(
  exec: SelectExecutor,
  categoryId: string,
  fund: { entityId: string; kind: string },
  flow: string,
  opts: { requireActive?: boolean } = {},
): Promise<{ ok: true; category: CategoryFitRow } | FitFailure> {
  if (!isUuid(categoryId)) {
    return { ok: false, status: 404, code: "category_not_found", error: "Category not found" };
  }
  const rows = await exec
    .select({
      id: ledgerCategories.id,
      entityId: ledgerCategories.entityId,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
      isActive: ledgerCategories.isActive,
      name: ledgerCategories.name,
    })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  const category = rows[0];
  const fit = checkCategoryFit(category, fund, flow, opts);
  if (!fit.ok) return fit;
  return { ok: true, category: category as CategoryFitRow };
}

export interface BankAccountFitRow {
  id: string;
  entityId: string;
  isActive: boolean;
}

export function checkBankAccountFit(
  acct: BankAccountFitRow | undefined,
  entityId: string,
  opts: { requireActive?: boolean } = {},
): { ok: true } | FitFailure {
  if (!acct) {
    return { ok: false, status: 400, code: "bank_account_invalid", error: "Bank account not found." };
  }
  if (acct.entityId !== entityId) {
    return {
      ok: false,
      status: 400,
      code: "bank_account_invalid",
      error: "Bank account does not belong to this entity.",
    };
  }
  if (opts.requireActive && !acct.isActive) {
    return {
      ok: false,
      status: 400,
      code: "bank_account_invalid",
      error: "Bank account is inactive. Select an active account.",
    };
  }
  return { ok: true };
}

/**
 * Load a bank account and check it against an entity. A malformed id is a 400
 * and never reaches the database (a bad uuid would otherwise be a Postgres 500).
 */
export async function validateBankAccountForEntity(
  exec: SelectExecutor,
  bankAccountId: string,
  entityId: string,
  opts: { requireActive?: boolean } = {},
): Promise<{ ok: true } | FitFailure> {
  if (typeof bankAccountId !== "string" || !isUuid(bankAccountId)) {
    return {
      ok: false,
      status: 400,
      code: "bank_account_invalid",
      error: "Select a valid bank account.",
    };
  }
  const rows = await exec
    .select({
      id: ledgerBankAccounts.id,
      entityId: ledgerBankAccounts.entityId,
      isActive: ledgerBankAccounts.isActive,
    })
    .from(ledgerBankAccounts)
    .where(eq(ledgerBankAccounts.id, bankAccountId))
    .limit(1);
  return checkBankAccountFit(rows[0], entityId, opts);
}
