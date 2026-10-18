/**
 * Unit tests for src/lib/ledger-category-queries.ts (Ledger Category
 * Management, 2026-08-07 / DECISION-065/066). Covers Phase 3's named tests
 * 4-10 (tests 1-3, the pure ledger.ts validators, are database-admin's —
 * see src/lib/ledger.test.ts):
 *   4. mergeCategories refuses when source has transactions, count in message.
 *   5. mergeCategories refuses on same-FY both-sides budget collision.
 *   6. mergeCategories refuses on inactive destination, succeeds once reactivated.
 *   7. confirm:false plan and confirm:true apply agree.
 *   8. getCategoryImpact budget-line counts/locked flags correct across FYs.
 *   9. getCategoryImpact.postedGivingCents matches getPhilanthropy's filter
 *      (structural WHERE assertion) and short-circuits to 0 for income-flow
 *      / administrative-fund categories.
 *  10. A ledgerAuditLog row is written per operation type, with the
 *      name-wins precedence rule honored when multiple fields change.
 *
 * Also covers the 2026-08-07 treasurer decision (DECISION-067): mergeCategories
 * refuses the WHOLE merge, naming the locked year(s), whenever any fiscal year
 * it would re-point is locked — not a partial merge that skips just the locked
 * year(s) — for both confirm:false and confirm:true.
 *
 * Also covers the 2026-08-08 treasurer decision (DECISION-068): mergeCategories
 * ALSO refuses the WHOLE merge, naming the year(s), whenever any fiscal year it
 * would re-point is EARLIER than the current fiscal year — regardless of lock
 * status, and checked BEFORE the locked-year check above. The three locked-year
 * tests above use FY2027/FY2028 (future, non-prior) rather than FY2024/FY2025 so
 * each test isolates the specific condition its name says it tests, now that a
 * fiscal year can trigger either refusal independently.
 *
 * Hermetic: mocks @/lib/db (FIFO select queue + captured insert/update
 * calls, mirroring the established pattern in src/lib/ledger-queries.test.ts)
 * and @/lib/ledger-queries (assertBudgetUnlocked only — the one function
 * this module imports from it). System time is pinned so
 * currentFiscalYear(new Date()) is deterministic across tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    wheres: [] as unknown[],
    updateCalls: [] as { table: unknown; values: Record<string, unknown> }[],
    updateReturningQueue: [] as unknown[][],
    insertCalls: [] as { table: unknown; values: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => {
  function selectChain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => obj,
      groupBy: () => obj,
      limit: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.selectQueue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }

  function makeClient() {
    return {
      select: () => selectChain(),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          mockDbState.insertCalls.push({ table, values });
          return Promise.resolve(undefined);
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            mockDbState.updateCalls.push({ table, values });
            const p = Promise.resolve(undefined) as Promise<unknown> & {
              returning: () => Promise<unknown[]>;
            };
            p.returning = () => Promise.resolve(mockDbState.updateReturningQueue.shift() ?? []);
            return p;
          },
        }),
      }),
    };
  }

  return {
    db: {
      ...makeClient(),
      transaction: async (cb: (tx: unknown) => unknown) => cb(makeClient()),
    },
  };
});

vi.mock("@/lib/ledger-queries", () => ({
  assertBudgetUnlocked: vi.fn(),
}));

import {
  getCategoryImpact,
  updateCategory,
  determineCategoryUpdateAction,
  mergeCategories,
  toCategoryDTO,
  validateMirrorWrite,
} from "./ledger-category-queries";
import { assertBudgetUnlocked } from "./ledger-queries";
import { ledgerAuditLog, ledgerBudgets } from "./db/schema";

function resetMockDb() {
  mockDbState.selectQueue = [];
  mockDbState.wheres = [];
  mockDbState.updateCalls = [];
  mockDbState.updateReturningQueue = [];
  mockDbState.insertCalls = [];
}

beforeEach(() => {
  resetMockDb();
  vi.mocked(assertBudgetUnlocked).mockResolvedValue({ ok: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-07T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const CLUB_ENTITY_ID = "entity-club";

function category(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cat-1",
    entityId: CLUB_ENTITY_ID,
    fundKind: "activity",
    flow: "expense",
    name: "Original Name",
    form990Line: null,
    sortOrder: 0,
    isActive: true,
    countsAsGiving: true,
    ackNotRequired: false,
    mirrorsCategoryId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// determineCategoryUpdateAction — pure precedence rule (DECISION-066 item 6)
// ---------------------------------------------------------------------------

describe("determineCategoryUpdateAction", () => {
  it("returns category_renamed when name changed, even alongside isActive", () => {
    expect(determineCategoryUpdateAction({ name: "New Name", isActive: false })).toBe(
      "category_renamed",
    );
  });

  it("returns category_reactivated when isActive changed false -> true and name didn't change", () => {
    expect(determineCategoryUpdateAction({ isActive: true })).toBe("category_reactivated");
  });

  it("returns category_deactivated when isActive changed true -> false and name didn't change", () => {
    expect(determineCategoryUpdateAction({ isActive: false })).toBe("category_deactivated");
  });

  it("returns category_flags_updated when neither name nor isActive changed", () => {
    expect(determineCategoryUpdateAction({})).toBe("category_flags_updated");
  });

  it("returns category_mirror_changed for a counterpart change, including a clear (null)", () => {
    expect(determineCategoryUpdateAction({ mirrorsCategoryId: "f-1" })).toBe("category_mirror_changed");
    expect(determineCategoryUpdateAction({ mirrorsCategoryId: null })).toBe("category_mirror_changed");
  });

  it("precedence is name, then isActive, then mirror, then flags", () => {
    expect(determineCategoryUpdateAction({ name: "x", isActive: false, mirrorsCategoryId: "f" })).toBe("category_renamed");
    expect(determineCategoryUpdateAction({ isActive: true, mirrorsCategoryId: "f" })).toBe("category_reactivated");
    expect(determineCategoryUpdateAction({ mirrorsCategoryId: "f" })).toBe("category_mirror_changed");
  });
});

describe("updateCategory — counterpart (B-172)", () => {
  it("sets the counterpart and writes category_mirror_changed with ids only", async () => {
    const existing = category({ flow: "income" });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, mirrorsCategoryId: "f-1" }]);

    const result = await updateCategory("cat-1", { mirrorsCategoryId: "f-1" }, "user-1");

    expect(result.ok).toBe(true);
    expect(mockDbState.updateCalls[0].values.mirrorsCategoryId).toBe("f-1");
    expect(mockDbState.insertCalls).toHaveLength(1);
    const audit = mockDbState.insertCalls[0].values;
    expect(audit.action).toBe("category_mirror_changed");
    expect(audit.targetCategoryId).toBe("cat-1");
    expect(JSON.parse(audit.before as string)).toEqual({ mirrorsCategoryId: null });
    expect(JSON.parse(audit.after as string)).toEqual({ mirrorsCategoryId: "f-1" });
    expect(audit.details).toBeNull();
  });

  it("clears the counterpart (null) and audits the change", async () => {
    const existing = category({ flow: "income", mirrorsCategoryId: "f-1" });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, mirrorsCategoryId: null }]);

    await updateCategory("cat-1", { mirrorsCategoryId: null }, "user-1");

    expect(mockDbState.updateCalls[0].values.mirrorsCategoryId).toBeNull();
    const audit = mockDbState.insertCalls[0].values;
    expect(audit.action).toBe("category_mirror_changed");
    expect(JSON.parse(audit.after as string)).toEqual({ mirrorsCategoryId: null });
  });

  it("setting the stored value again is a no-op: no UPDATE, no audit row", async () => {
    const existing = category({ flow: "income", mirrorsCategoryId: "f-1" });
    mockDbState.selectQueue.push([existing]);

    const result = await updateCategory("cat-1", { mirrorsCategoryId: "f-1" }, "user-1");

    expect(result.ok).toBe(true);
    expect(mockDbState.updateCalls).toHaveLength(0);
    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("a rename alongside a counterpart change keeps the rename action but records both fields", async () => {
    const existing = category({ flow: "income", name: "Gala" });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, name: "Gala 2", mirrorsCategoryId: "f-1" }]);

    await updateCategory("cat-1", { name: "Gala 2", mirrorsCategoryId: "f-1" }, "user-1");

    const audit = mockDbState.insertCalls[0].values;
    expect(audit.action).toBe("category_renamed");
    expect(Object.keys(JSON.parse(audit.after as string)).sort()).toEqual(["mirrorsCategoryId", "name"]);
  });

  it("the DTO carries the counterpart id and the read-only projection", () => {
    const projection = {
      id: "f-1",
      name: "Public donations",
      isActive: true,
      countsAsGiving: true,
      ackNotRequired: false,
      form990Line: null,
    };
    const dto = toCategoryDTO(category({ flow: "income", mirrorsCategoryId: "f-1" }) as never, projection);
    expect(dto.mirrorsCategoryId).toBe("f-1");
    expect(dto.mirror).toEqual(projection);
    expect(toCategoryDTO(category() as never).mirror).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateCategory — Phase 3 test 10: one audit row per operation type
// ---------------------------------------------------------------------------

describe("updateCategory — audit trail", () => {
  it("rename: writes a category_renamed audit row with only name in before/after", async () => {
    const existing = category({ name: "Awards" });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, name: "Member recognition" }]);

    const result = await updateCategory("cat-1", { name: "Member recognition" }, "user-1");

    expect(result.ok).toBe(true);
    expect(mockDbState.insertCalls).toHaveLength(1);
    const audit = mockDbState.insertCalls[0];
    expect(audit.table).toBe(ledgerAuditLog);
    expect(audit.values.action).toBe("category_renamed");
    expect(audit.values.actorUserId).toBe("user-1");
    expect(audit.values.targetCategoryId).toBe("cat-1");
    expect(JSON.parse(audit.values.before as string)).toEqual({ name: "Awards" });
    expect(JSON.parse(audit.values.after as string)).toEqual({ name: "Member recognition" });
  });

  it("deactivate: writes a category_deactivated audit row", async () => {
    const existing = category({ isActive: true });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, isActive: false }]);

    await updateCategory("cat-1", { isActive: false }, "user-1");

    const audit = mockDbState.insertCalls[0];
    expect(audit.values.action).toBe("category_deactivated");
    expect(JSON.parse(audit.values.before as string)).toEqual({ isActive: true });
    expect(JSON.parse(audit.values.after as string)).toEqual({ isActive: false });
  });

  it("reactivate: writes a category_reactivated audit row", async () => {
    const existing = category({ isActive: false });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, isActive: true }]);

    await updateCategory("cat-1", { isActive: true }, "user-1");

    const audit = mockDbState.insertCalls[0];
    expect(audit.values.action).toBe("category_reactivated");
  });

  it("flags-only: countsAsGiving + form990Line change writes a category_flags_updated audit row", async () => {
    const existing = category({ countsAsGiving: true, form990Line: null });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([
      { ...existing, countsAsGiving: false, form990Line: "Line 4a" },
    ]);

    await updateCategory(
      "cat-1",
      { countsAsGiving: false, form990Line: "Line 4a" },
      "user-1",
    );

    const audit = mockDbState.insertCalls[0];
    expect(audit.values.action).toBe("category_flags_updated");
    expect(JSON.parse(audit.values.before as string)).toEqual({
      countsAsGiving: true,
      form990Line: null,
    });
    expect(JSON.parse(audit.values.after as string)).toEqual({
      countsAsGiving: false,
      form990Line: "Line 4a",
    });
  });

  it("flags-only: ackNotRequired change alone writes a category_flags_updated audit row with only that field in before/after", async () => {
    const existing = category({ ackNotRequired: false });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, ackNotRequired: true }]);

    await updateCategory("cat-1", { ackNotRequired: true }, "user-1");

    const audit = mockDbState.insertCalls[0];
    expect(audit.values.action).toBe("category_flags_updated");
    expect(JSON.parse(audit.values.before as string)).toEqual({ ackNotRequired: false });
    expect(JSON.parse(audit.values.after as string)).toEqual({ ackNotRequired: true });
    expect(mockDbState.updateCalls[0].values).toMatchObject({ ackNotRequired: true });
  });

  it("no-op ackNotRequired patch (value equals current) writes no audit row and issues no UPDATE", async () => {
    const existing = category({ ackNotRequired: true });
    mockDbState.selectQueue.push([existing]);

    const result = await updateCategory("cat-1", { ackNotRequired: true }, "user-1");

    expect(result).toEqual({ ok: true, category: existing });
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("simultaneous rename + deactivate: action is category_renamed but before/after carry both fields", async () => {
    const existing = category({ name: "Awards", isActive: true });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([
      { ...existing, name: "Member recognition", isActive: false },
    ]);

    await updateCategory(
      "cat-1",
      { name: "Member recognition", isActive: false },
      "user-1",
    );

    const audit = mockDbState.insertCalls[0];
    expect(audit.values.action).toBe("category_renamed");
    expect(JSON.parse(audit.values.before as string)).toEqual({
      name: "Awards",
      isActive: true,
    });
    expect(JSON.parse(audit.values.after as string)).toEqual({
      name: "Member recognition",
      isActive: false,
    });
  });

  it("404s when the category doesn't exist, writes no audit row", async () => {
    mockDbState.selectQueue.push([]);

    const result = await updateCategory("missing-id", { name: "Whatever" }, "user-1");

    expect(result).toEqual({ ok: false, error: "Category not found", status: 404 });
    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("no-op patch (value equals current) writes no audit row and issues no UPDATE", async () => {
    const existing = category({ name: "Awards" });
    mockDbState.selectQueue.push([existing]);

    const result = await updateCategory("cat-1", { name: "Awards" }, "user-1");

    expect(result).toEqual({ ok: true, category: existing });
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mergeCategories — Phase 3 tests 4, 5, 6, 7
// ---------------------------------------------------------------------------

function activeCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return category({ isActive: true, ...overrides });
}

describe("mergeCategories", () => {
  it("test 4: refuses when the source has any transactions, with the count in the message", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    mockDbState.selectQueue.push([source], [destination], [{ n: 3 }]);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("3 transaction");
    }
    // No writes on refusal.
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("test 4b: singular 'transaction' (not 'transactions') when the count is exactly 1", async () => {
    const source = activeCategory({ id: "src" });
    const destination = activeCategory({ id: "dst" });
    mockDbState.selectQueue.push([source], [destination], [{ n: 1 }]);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1 transaction —");
  });

  it("test 5: refuses when both source and destination have a budget row in the same fiscal year", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    mockDbState.selectQueue.push(
      [source],
      [destination],
      [{ n: 0 }], // no transactions
      [
        {
          id: "budget-src-2026",
          fiscalYear: 2026,
          annualAmountCents: 20000,
          entityName: "Westerville Lions Club",
          fundName: "Activity Fund",
          approvalStatus: null,
        },
      ], // source budget rows
      [{ fiscalYear: 2026 }], // destination budget years — collides
    );

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2026");
      expect(result.error).toContain("Awards");
      expect(result.error).toContain("Member recognition");
      expect(result.error).toContain("resolve by hand");
    }
  });

  it("test 6: refuses when the destination is inactive, succeeds once reactivated", async () => {
    const source = activeCategory({ id: "src" });
    const inactiveDestination = category({ id: "dst", isActive: false, name: "Old dest" });

    mockDbState.selectQueue.push([source], [inactiveDestination]);

    const refused = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.status).toBe(409);
      expect(refused.error).toContain("deactivated");
      expect(refused.error).toContain("Reactivate it first");
    }

    // Same scenario, destination now active — succeeds through to a plan.
    resetMockDb();
    const activeDestination = category({ id: "dst", isActive: true, name: "New dest" });
    mockDbState.selectQueue.push(
      [source],
      [activeDestination],
      [{ n: 0 }],
      [], // no source budget rows
      [], // no destination budget years
    );

    const succeeded = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(succeeded.ok).toBe(true);
    if (succeeded.ok && !succeeded.confirm) {
      expect(succeeded.destinationName).toBe("New dest");
      expect(succeeded.plan).toEqual([]);
    }
  });

  it("test 7: confirm:false plan and confirm:true apply agree for 2+ non-conflicting years", async () => {
    const source = activeCategory({ id: "src", name: "Supplies" });
    const destination = activeCategory({ id: "dst", name: "Program supplies" });

    // Both years unlocked AND neither is prior to the current fiscal year
    // (system time pinned to 2026-08-07 -> currentFY 2026) — either a
    // locked year or a prior year would now refuse the whole merge (see the
    // "refuses the whole merge..." / "refuses when an affected fiscal
    // year..." tests below), so this test's plan/apply-agreement scenario
    // must stay entirely unlocked and non-prior to exercise what it's
    // actually testing. FY2024 -> FY2027 here (2026-08-08, DECISION-068).
    const sourceBudgetRows = [
      {
        id: "budget-2026",
        fiscalYear: 2026,
        annualAmountCents: 5000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
      {
        id: "budget-2027",
        fiscalYear: 2027,
        annualAmountCents: 70000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: null,
      },
    ];

    // --- Plan (confirm: false) ---
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);
    const plan = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.confirm) throw new Error("expected a plan response");
    expect(plan.plan).toEqual([
      {
        fiscalYear: 2026,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        annualAmountCents: 5000,
        locked: false,
      },
      {
        fiscalYear: 2027,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        annualAmountCents: 70000,
        locked: false,
      },
    ]);

    // --- Apply (confirm: true) — identical checks re-run fresh ---
    resetMockDb();
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);
    const apply = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: true,
      actorUserId: "user-1",
    });

    expect(apply.ok).toBe(true);
    if (!apply.ok || !apply.confirm) throw new Error("expected an apply response");
    expect(apply.destinationId).toBe("dst");
    expect(apply.affectedFiscalYears.sort()).toEqual(
      plan.plan.map((p) => p.fiscalYear).sort(),
    );

    // Every planned budget row was re-pointed to the destination.
    const budgetUpdates = mockDbState.updateCalls.filter((c) => c.table === ledgerBudgets);
    expect(budgetUpdates).toHaveLength(2);
    for (const u of budgetUpdates) {
      expect(u.values.categoryId).toBe("dst");
    }

    // One audit row, action category_merged, targeting the source.
    expect(mockDbState.insertCalls).toHaveLength(1);
    expect(mockDbState.insertCalls[0].values.action).toBe("category_merged");
    expect(mockDbState.insertCalls[0].values.targetCategoryId).toBe("src");
    expect(mockDbState.insertCalls[0].values.before).toBeNull();
    expect(mockDbState.insertCalls[0].values.after).toBeNull();
  });

  it("refuses on same id, without any DB call", async () => {
    const result = await mergeCategories({
      sourceId: "same",
      destinationId: "same",
      confirm: false,
      actorUserId: "user-1",
    });
    expect(result).toEqual({
      ok: false,
      error: "sourceId and destinationId must be different.",
      status: 400,
    });
    expect(mockDbState.selectQueue).toHaveLength(0); // nothing consumed
  });

  it("refuses on entity/fund/flow scope mismatch", async () => {
    const source = activeCategory({ id: "src", fundKind: "activity" });
    const destination = activeCategory({ id: "dst", fundKind: "charitable" });
    mockDbState.selectQueue.push([source], [destination]);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("same entity, fund, and flow");
    }
  });

  it("refuses when the current fiscal year is locked", async () => {
    const source = activeCategory({ id: "src" });
    const destination = activeCategory({ id: "dst" });
    mockDbState.selectQueue.push([source], [destination]);
    vi.mocked(assertBudgetUnlocked).mockResolvedValueOnce({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    });

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    });
  });

  // ---------------------------------------------------------------------
  // 2026-08-07 treasurer decision (DECISION-067): merge refuses the WHOLE
  // operation, naming the year(s), whenever any fiscal year it would
  // re-point is locked — not just the current one, and not a partial
  // merge that skips the locked year and proceeds for the rest.
  // ---------------------------------------------------------------------

  it("refuses the whole merge when a non-current affected fiscal year is locked, naming it", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    // FY2027 (locked) is deliberately a FUTURE year, not a prior one — this
    // test isolates the locked-year check (step 9) from the prior-fiscal-
    // year check (step 8, DECISION-068), which would otherwise fire first
    // for any year before the current FY (2026) regardless of lock status.
    const sourceBudgetRows = [
      {
        id: "budget-2027",
        fiscalYear: 2027,
        annualAmountCents: 5000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "locked",
      },
      {
        id: "budget-2026",
        fiscalYear: 2026,
        annualAmountCents: 70000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2027");
      expect(result.error).toContain("Awards");
      expect(result.error).toContain("Member recognition");
      expect(result.error).toContain("locked");
      // Not mentioning the unaffected/unlocked year as if it were part of
      // the reason — the message should read as blocking the whole merge,
      // not describing a per-year outcome.
      expect(result.error).not.toContain("FY2026");
    }
    // Whole-merge refusal, not a partial merge: no writes at all, even
    // though FY2026 alone would have been mergeable on its own.
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("refuses the whole merge (confirm:true) identically to the confirm:false plan, with no writes", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    const sourceBudgetRows = [
      {
        id: "budget-2027",
        fiscalYear: 2027,
        annualAmountCents: 5000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "locked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: true,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2027");
    }
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("refuses and names every locked year (plural grammar) when more than one affected year is locked", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    const sourceBudgetRows = [
      {
        id: "budget-2027",
        fiscalYear: 2027,
        annualAmountCents: 5000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "locked",
      },
      {
        id: "budget-2028",
        fiscalYear: 2028,
        annualAmountCents: 6000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "locked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2027");
      expect(result.error).toContain("FY2028");
      expect(result.error).toContain("are locked");
    }
  });

  it("does not refuse on a lock when no affected fiscal year is actually locked", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    const sourceBudgetRows = [
      {
        id: "budget-2026",
        fiscalYear: 2026,
        annualAmountCents: 20000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 2026-08-08 treasurer decision (DECISION-068): merge ALSO refuses the
  // WHOLE operation, naming the year(s), whenever any fiscal year it would
  // re-point is EARLIER than the current fiscal year (2026) — regardless
  // of lock status. This corrects the finding that the locked-year check
  // above never actually fires in practice, because no fiscal year has
  // ever been locked in the real database (Phase 6 re-check,
  // docs/work-log/2026-08-07-ledger-category-management.md).
  // ---------------------------------------------------------------------

  it("refuses when an affected fiscal year is earlier than the current fiscal year, naming it, even though it is NOT locked", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    // FY2025 is prior to currentFY (2026, per the pinned system time) and
    // deliberately UNLOCKED — this is exactly the real Awards/Supplies
    // scenario the Phase 6 re-check found the old lock-only guard missed.
    const sourceBudgetRows = [
      {
        id: "budget-2025",
        fiscalYear: 2025,
        annualAmountCents: 20000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2025");
      expect(result.error).toContain("Awards");
      expect(result.error).toContain("Member recognition");
      expect(result.error).toContain("prior fiscal year");
      expect(result.error).toContain("already closed");
      // Distinguishable from the locked-year refusal's wording.
      expect(result.error).not.toContain("Unlock");
    }
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("refuses (confirm:true) identically when an affected fiscal year is earlier than the current fiscal year, with no writes", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    const sourceBudgetRows = [
      {
        id: "budget-2025",
        fiscalYear: 2025,
        annualAmountCents: 20000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: true,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2025");
    }
    expect(mockDbState.insertCalls).toHaveLength(0);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("names every prior fiscal year (plural grammar) when more than one affected year is earlier than the current FY", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    const sourceBudgetRows = [
      {
        id: "budget-2024",
        fiscalYear: 2024,
        annualAmountCents: 5000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
      {
        id: "budget-2025",
        fiscalYear: 2025,
        annualAmountCents: 6000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("FY2024");
      expect(result.error).toContain("FY2025");
      expect(result.error).toContain("are prior fiscal years");
    }
  });

  it("the prior-fiscal-year check runs BEFORE the locked-year check when a year is both prior and locked", async () => {
    const source = activeCategory({ id: "src", name: "Awards" });
    const destination = activeCategory({ id: "dst", name: "Member recognition" });
    // FY2025 is both prior to currentFY AND locked — the prior-fiscal-year
    // message should win (it doesn't depend on lock status and is checked
    // first, per DECISION-068's doc comment in mergeCategories()).
    const sourceBudgetRows = [
      {
        id: "budget-2025",
        fiscalYear: 2025,
        annualAmountCents: 20000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "locked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("prior fiscal year");
      expect(result.error).toContain("already closed");
    }
  });

  it("a merge confined to the current fiscal year still succeeds (not prior, not locked)", async () => {
    const source = activeCategory({ id: "src", name: "Event costs" });
    const destination = activeCategory({ id: "dst", name: "Service projects" });
    const sourceBudgetRows = [
      {
        id: "budget-2026",
        fiscalYear: 2026,
        annualAmountCents: 15000,
        entityName: "Westerville Lions Club",
        fundName: "Activity Fund",
        approvalStatus: "unlocked",
      },
    ];
    mockDbState.selectQueue.push([source], [destination], [{ n: 0 }], sourceBudgetRows, []);

    const result = await mergeCategories({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok && !result.confirm) {
      expect(result.plan).toEqual([
        {
          fiscalYear: 2026,
          entityName: "Westerville Lions Club",
          fundName: "Activity Fund",
          annualAmountCents: 15000,
          locked: false,
        },
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// getCategoryImpact — Phase 3 tests 8, 9
// ---------------------------------------------------------------------------

describe("getCategoryImpact", () => {
  it("test 8: budget-line counts and locked flags are correct across fiscal years", async () => {
    const cat = category({ id: "cat-1", flow: "income" }); // income -> giving query skipped
    mockDbState.selectQueue.push(
      [cat], // getCategoryById
      [{ n: 5 }], // transaction count
      [
        {
          fiscalYear: 2024,
          entityName: "Westerville Lions Club",
          fundName: "Activity Fund",
          flow: "income",
          annualAmountCents: 10000,
          approvalStatus: "locked",
        },
        {
          fiscalYear: 2026,
          entityName: "Westerville Lions Club",
          fundName: "Activity Fund",
          flow: "income",
          annualAmountCents: 15000,
          approvalStatus: "unlocked",
        },
      ], // budget rows
    );

    const impact = await getCategoryImpact("cat-1");

    expect(impact).not.toBeNull();
    expect(impact!.budgetLines.total).toBe(2);
    expect(impact!.transactions.total).toBe(5);
    const byYear = new Map(impact!.budgetLines.fiscalYears.map((fy) => [fy.fiscalYear, fy]));
    expect(byYear.get(2024)?.locked).toBe(true);
    expect(byYear.get(2026)?.locked).toBe(false);
  });

  it("returns null when the category doesn't exist", async () => {
    mockDbState.selectQueue.push([]);
    const impact = await getCategoryImpact("missing");
    expect(impact).toBeNull();
  });

  it("test 9a: postedGivingCents is 0 without a giving query for an income-flow category", async () => {
    const cat = category({ id: "cat-1", flow: "income", fundKind: "activity" });
    mockDbState.selectQueue.push([cat], [{ n: 0 }], [], []);

    const impact = await getCategoryImpact("cat-1");

    expect(impact!.transactions.postedGivingCents).toBe(0);
    // Only 4 selects consumed (category, txn count, budget rows, mirroredBy) — no giving query.
    expect(mockDbState.selectQueue).toHaveLength(0);
    expect(mockDbState.wheres).toHaveLength(4);
  });

  it("test 9b: postedGivingCents is 0 without a giving query for an administrative-fund category", async () => {
    const cat = category({ id: "cat-1", flow: "expense", fundKind: "administrative" });
    mockDbState.selectQueue.push([cat], [{ n: 0 }], [], []);

    const impact = await getCategoryImpact("cat-1");

    expect(impact!.transactions.postedGivingCents).toBe(0);
    expect(mockDbState.wheres).toHaveLength(4);
  });

  it("test 9c: postedGivingCents is queried with getPhilanthropy's exact filter for an eligible category", async () => {
    const cat = category({ id: "cat-1", flow: "expense", fundKind: "activity" });
    mockDbState.selectQueue.push(
      [cat], // getCategoryById
      [{ n: 4 }], // transaction count
      [{ total: 87654 }], // giving sum
      [], // budget rows
    );

    const impact = await getCategoryImpact("cat-1");

    expect(impact!.transactions.postedGivingCents).toBe(87654);

    // wheres[0] = category lookup, wheres[1] = txn count, wheres[2] = giving sum.
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(mockDbState.wheres[2] as never);
    // Same conditions getPhilanthropy uses (ledger-queries.ts:4705-4712) minus
    // countsAsGiving: categoryId eq, status='posted', transferGroupId IS NULL
    // (no param), flow='expense', fund.kind IN (activity, charitable, scholarship).
    expect(params).toEqual([
      "cat-1",
      "posted",
      "expense",
      "activity",
      "charitable",
      "scholarship",
    ]);
    expect(sql).toContain("is null"); // transferGroupId IS NULL, no bound param
  });
});

// ---------------------------------------------------------------------------
// B-172: merge re-points counterpart links; impact reports them
// ---------------------------------------------------------------------------

describe("mergeCategories — counterpart links (B-172)", () => {
  const src = (o: Record<string, unknown> = {}) => category({ id: "src", name: "Gala", fundKind: "charitable", flow: "income", ...o });
  const dst = (o: Record<string, unknown> = {}) => category({ id: "dst", name: "Gala (new)", fundKind: "charitable", flow: "income", ...o });

  it("refuses 409 mirror_conflict when both have a counterpart and they differ, before any write", async () => {
    mockDbState.selectQueue.push([src({ mirrorsCategoryId: "f-1" })], [dst({ mirrorsCategoryId: "f-2" })]);

    const result = await mergeCategories({ sourceId: "src", destinationId: "dst", confirm: true, actorUserId: "u" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("mirror_conflict");
    }
    expect(mockDbState.updateCalls).toHaveLength(0);
    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("the same counterpart on both, or only one side, is not a conflict", async () => {
    for (const [a, b] of [["f-1", "f-1"], ["f-1", null], [null, "f-1"]] as const) {
      resetMockDb();
      mockDbState.selectQueue.push([src({ mirrorsCategoryId: a })], [dst({ mirrorsCategoryId: b })], [{ n: 0 }], [], [], [{ n: 0 }]);
      const result = await mergeCategories({ sourceId: "src", destinationId: "dst", confirm: false, actorUserId: "u" });
      expect(result.ok).toBe(true);
    }
  });

  it("the plan reports mirrorsRepointed and writes nothing", async () => {
    mockDbState.selectQueue.push([src()], [dst()], [{ n: 0 }], [], [], [{ n: 2 }]);

    const result = await mergeCategories({ sourceId: "src", destinationId: "dst", confirm: false, actorUserId: "u" });

    expect(result.ok && !result.confirm && result.mirrorsRepointed).toBe(2);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("confirm re-points categories that mirror the source, counts them in the audit details, and reports the count", async () => {
    mockDbState.selectQueue.push([src()], [dst()], [{ n: 0 }], [], [], [{ n: 3 }]);

    const result = await mergeCategories({ sourceId: "src", destinationId: "dst", confirm: true, actorUserId: "u" });

    expect(result.ok && result.confirm && result.mirrorsRepointed).toBe(3);
    const repoint = mockDbState.updateCalls.find((c) => "mirrorsCategoryId" in c.values);
    expect(repoint?.values.mirrorsCategoryId).toBe("dst");
    const audit = mockDbState.insertCalls[0].values;
    expect(audit.action).toBe("category_merged");
    expect(audit.details).toContain("Counterpart links re-pointed: 3");
  });

  it("confirm with nothing to re-point issues no counterpart UPDATE", async () => {
    mockDbState.selectQueue.push([src()], [dst()], [{ n: 0 }], [], [], [{ n: 0 }]);

    await mergeCategories({ sourceId: "src", destinationId: "dst", confirm: true, actorUserId: "u" });

    expect(mockDbState.updateCalls.some((c) => "mirrorsCategoryId" in c.values)).toBe(false);
  });
});

describe("getCategoryImpact — counterpart (B-172)", () => {
  it("returns the category's counterpart and the categories that point at it (names capped at 10)", async () => {
    const cat = category({ id: "cat-1", flow: "income", fundKind: "charitable", mirrorsCategoryId: null });
    const names = Array.from({ length: 12 }, (_, i) => ({ name: `Club ${i}` }));
    mockDbState.selectQueue.push([cat], [{ n: 0 }], [], names);

    const impact = await getCategoryImpact("cat-1");

    expect(impact!.mirror).toBeNull();
    expect(impact!.mirroredBy.count).toBe(12);
    expect(impact!.mirroredBy.names).toHaveLength(10);
    expect(impact!.category.mirrorsCategoryId).toBeNull();
  });

  it("names the counterpart, its active state and its entity", async () => {
    const cat = category({ id: "cat-1", flow: "income", mirrorsCategoryId: "f-1" });
    mockDbState.selectQueue.push(
      [cat],
      [{ n: 0 }],
      [],
      [{ id: "f-1", name: "Public donations", isActive: false, entityName: "Westerville Lions Foundation" }],
      [],
    );

    const impact = await getCategoryImpact("cat-1");

    expect(impact!.mirror).toEqual({
      id: "f-1",
      name: "Public donations",
      isActive: false,
      entityName: "Westerville Lions Foundation",
    });
    expect(impact!.mirroredBy).toEqual({ count: 0, names: [] });
  });
});

describe("validateMirrorWrite (B-172)", () => {
  const subject = { id: "cat-1", entityId: "e-club", fundKind: "activity", flow: "income" };
  const target = (o: Record<string, unknown> = {}) => ({
    id: "f-1",
    entityId: "e-fnd",
    fundKind: "charitable",
    flow: "income",
    isActive: true,
    ...o,
  });
  const entities = [
    { id: "e-club", donationsDeductible: false },
    { id: "e-fnd", donationsDeductible: true },
  ];
  const labelRows = [{ kind: "activity", name: "Community Pool", isActive: true }];

  it("null target clears without touching the database", async () => {
    expect(await validateMirrorWrite(subject, null)).toEqual({ ok: true });
    expect(mockDbState.wheres).toHaveLength(0);
  });

  it("accepts an active Foundation charitable income category", async () => {
    mockDbState.selectQueue.push([target()], entities);
    expect(await validateMirrorWrite(subject, "f-1")).toEqual({ ok: true });
  });

  it("404 mirror_target_not_found for an unknown target", async () => {
    mockDbState.selectQueue.push([]);
    const r = await validateMirrorWrite(subject, "missing");
    expect(r).toMatchObject({ ok: false, status: 404, code: "mirror_target_not_found" });
  });

  it("400 with the pure check's code, worded with the stored fund name", async () => {
    mockDbState.selectQueue.push([target({ isActive: false })], entities, labelRows);
    const r = await validateMirrorWrite(subject, "f-1");
    expect(r).toMatchObject({ ok: false, status: 400, code: "target_inactive" });

    mockDbState.selectQueue.push([target({ flow: "expense" })], entities, labelRows);
    expect(await validateMirrorWrite(subject, "f-1")).toMatchObject({ code: "target_not_foundation_income" });

    mockDbState.selectQueue.push([target({ entityId: "e-club", fundKind: "activity" })], entities, labelRows);
    expect(await validateMirrorWrite(subject, "f-1")).toMatchObject({ code: "target_not_foundation_income" });

    mockDbState.selectQueue.push([target()], entities, labelRows);
    const bad = await validateMirrorWrite({ ...subject, flow: "expense" }, "f-1");
    expect(bad).toMatchObject({ code: "subject_not_public_income" });
    if (!bad.ok) expect(bad.error).toContain("Community Pool");
  });

  it("POST (no subject id) never trips target_is_self", async () => {
    mockDbState.selectQueue.push([target()], entities);
    expect(await validateMirrorWrite({ ...subject, id: null }, "f-1")).toEqual({ ok: true });
  });
});
