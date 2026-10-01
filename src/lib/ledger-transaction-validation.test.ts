/** T11-T12: shared category and bank-account validation. */
import { describe, it, expect, vi } from "vitest";
import {
  checkBankAccountFit,
  checkCategoryFit,
  validateBankAccountForEntity,
  validateCategoryForFund,
  type SelectExecutor,
} from "./ledger-transaction-validation";

const FUND = { entityId: "e1", kind: "activity" };
const CAT = { id: "c1", entityId: "e1", fundKind: "activity", flow: "income", isActive: true };

describe("checkCategoryFit (T11)", () => {
  it("not found is 404", () => {
    expect(checkCategoryFit(undefined, FUND, "income")).toMatchObject({ ok: false, status: 404 });
  });
  it("entity mismatch is 400", () => {
    expect(checkCategoryFit({ ...CAT, entityId: "e2" }, FUND, "income")).toMatchObject({
      ok: false,
      status: 400,
    });
  });
  it("kind mismatch is 400 with the verbatim existing message", () => {
    expect(checkCategoryFit({ ...CAT, fundKind: "administrative" }, FUND, "income")).toMatchObject({
      ok: false,
      status: 400,
      error: "Category does not match fund type",
    });
  });
  it("flow mismatch is 400 with the verbatim existing message", () => {
    expect(checkCategoryFit(CAT, FUND, "expense")).toMatchObject({
      ok: false,
      status: 400,
      error: "Category flow does not match transaction flow",
    });
  });
  it("inactive fails only with requireActive", () => {
    const inactive = { ...CAT, isActive: false };
    expect(checkCategoryFit(inactive, FUND, "income")).toEqual({ ok: true });
    expect(checkCategoryFit(inactive, FUND, "income", { requireActive: true })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
  it("a fitting category is ok", () => {
    expect(checkCategoryFit(CAT, FUND, "income", { requireActive: true })).toEqual({ ok: true });
  });
});

const ACCT = { id: "a1", entityId: "e1", isActive: true };

describe("bank-account validation (T12)", () => {
  it("checkBankAccountFit: missing, cross-entity, inactive-only-with-requireActive, ok", () => {
    expect(checkBankAccountFit(undefined, "e1")).toMatchObject({ ok: false, status: 400 });
    expect(checkBankAccountFit({ ...ACCT, entityId: "e2" }, "e1")).toMatchObject({ ok: false, status: 400 });
    expect(checkBankAccountFit({ ...ACCT, isActive: false }, "e1")).toEqual({ ok: true });
    expect(checkBankAccountFit({ ...ACCT, isActive: false }, "e1", { requireActive: true })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(checkBankAccountFit(ACCT, "e1", { requireActive: true })).toEqual({ ok: true });
  });

  function exec(rows: unknown[]) {
    const limit = vi.fn(() => Promise.resolve(rows));
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
    return { exec: { select } as unknown as SelectExecutor, select };
  }

  it("a malformed id is a 400 and never reaches the database", async () => {
    const { exec: e, select } = exec([ACCT]);
    const r = await validateBankAccountForEntity(e, "not-a-uuid", "e1");
    expect(r).toMatchObject({ ok: false, status: 400, error: "Select a valid bank account." });
    expect(select).not.toHaveBeenCalled();
  });

  it("loads the row and applies the fit check", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(await validateBankAccountForEntity(exec([{ ...ACCT, id }]).exec, id, "e1")).toEqual({ ok: true });
    expect(await validateBankAccountForEntity(exec([]).exec, id, "e1")).toMatchObject({ ok: false, status: 400 });
    expect(
      await validateBankAccountForEntity(exec([{ ...ACCT, id, entityId: "e2" }]).exec, id, "e1"),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("validateCategoryForFund: malformed id is 404 without a query; otherwise returns the category", async () => {
    const bad = exec([CAT]);
    expect(await validateCategoryForFund(bad.exec, "nope", FUND, "income")).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(bad.select).not.toHaveBeenCalled();
    const id = "22222222-2222-4222-8222-222222222222";
    const ok = await validateCategoryForFund(exec([{ ...CAT, id, name: "Public donations" }]).exec, id, FUND, "income");
    expect(ok).toMatchObject({ ok: true, category: { id, name: "Public donations" } });
  });
});
