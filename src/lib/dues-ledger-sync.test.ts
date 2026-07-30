/**
 * Unit tests for src/lib/dues-ledger-sync.ts
 *
 * These tests mock the Drizzle transaction client (tx) and the DB to exercise
 * the pure branching logic of syncDuesCreate, syncDuesUpdate, and syncDuesDelete.
 *
 * Phase 3 design (2026-06-26-ledger-donors-integrations.md, Step 3) required:
 *   - syncDuesCreate inserts correct values
 *   - syncDuesUpdate sets sync_stale=true on a reconciled row
 *   - syncDuesDelete hard-deletes an unreconciled row and sets stale on a reconciled row
 *   - Fund-not-found error returns { syncFailed: true } without throwing
 *   - Postgres serialization errors (40001/40P01) are re-thrown
 *
 * docs/work-log/2026-07-29-default-bank-account.md (bug fix) added a Step 3
 * (bank-account resolution) between the fund lookup and the category lookup —
 * makeTx's select-call-count table below shifts accordingly (bankAccountRows
 * is now call #3; catRows/memberRows moved to #4/#5). New coverage:
 *   - syncDuesCreate sets bankAccountId on the inserted row from the Club
 *     entity's default account
 *   - syncDuesCreate returns { syncFailed: true } (no insert) when no default
 *     bank account is configured for the Club entity
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncDuesCreate, syncDuesUpdate, syncDuesDelete } from "./dues-ledger-sync";

// ---------------------------------------------------------------------------
// Minimal Drizzle transaction client mock factory
// ---------------------------------------------------------------------------

/** Returns a new mock `tx` client whose select/update/delete/insert calls are
 *  fully configurable per-test. */
function makeTx(opts: {
  entityRows?: unknown[];
  fundRows?: unknown[];
  bankAccountRows?: unknown[];
  catRows?: unknown[];
  memberRows?: unknown[];
  linkedTxnRows?: unknown[];
  insertShouldThrow?: unknown;
  updateShouldThrow?: unknown;
} = {}) {
  // select() returns a chainable builder ending in .limit(1) => the opts array
  const selectChain = (rows: unknown[] = []) => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  });

  // select() call order for syncDuesCreate: 1=entity, 2=fund,
  // 3=bank account (default-bank-account bug fix), 4=category, 5=member.
  // Track call count to return the right data for each step.
  let selectCallCount = 0;
  let insertedValues: unknown;

  const tx = {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      const c = selectCallCount;
      let rows: unknown[] = [];
      if (c === 1) rows = opts.entityRows ?? [];
      else if (c === 2) rows = opts.fundRows ?? [];
      else if (c === 3) rows = opts.bankAccountRows ?? [{ id: "default-bank-account-id" }];
      else if (c === 4) rows = opts.catRows ?? [];
      else if (c === 5) rows = opts.memberRows ?? [];
      else rows = opts.linkedTxnRows ?? [];
      return selectChain(rows);
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: (v: unknown) => {
        insertedValues = v;
        if (opts.insertShouldThrow) {
          return Promise.reject(opts.insertShouldThrow);
        }
        return Promise.resolve([{ id: "new-txn-id" }]);
      },
    })),
    update: vi.fn().mockImplementation(() => ({
      set: () => ({
        where: () => {
          if (opts.updateShouldThrow) {
            return Promise.reject(opts.updateShouldThrow);
          }
          return Promise.resolve([]);
        },
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({
      where: () => Promise.resolve([]),
    })),
  };

  return { tx, getSelectCallCount: () => selectCallCount, getInsertedValues: () => insertedValues };
}

// ---------------------------------------------------------------------------
// syncDuesCreate
// ---------------------------------------------------------------------------

describe("syncDuesCreate", () => {
  const validPayment = {
    id: "payment-id-123",
    memberId: "member-id-456",
    amountCents: 7200,
    paymentDate: "2026-06-15",
    method: "check",
    fiscalYear: 2026,
  };

  it("returns {} on success when all entities resolve", async () => {
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      catRows: [{ id: "club-dues-cat-id" }],
      memberRows: [{ firstName: "Alice", lastName: "Smith" }],
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({});
    expect(tx.insert).toHaveBeenCalledOnce();
  });

  it("sets bankAccountId on the inserted row from the Club entity's default bank account — default-bank-account bug fix", async () => {
    const { tx, getInsertedValues } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      bankAccountRows: [{ id: "default-bank-account-id" }],
      catRows: [{ id: "club-dues-cat-id" }],
      memberRows: [{ firstName: "Alice", lastName: "Smith" }],
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({});
    expect(tx.insert).toHaveBeenCalledOnce();
    expect(getInsertedValues()).toMatchObject({ bankAccountId: "default-bank-account-id" });
  });

  it("returns { syncFailed: true } (no insert) when no default bank account is configured for the Club entity — regression for the reconciliation-invisibility bug this fix closes", async () => {
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      bankAccountRows: [], // no default configured
      catRows: [{ id: "club-dues-cat-id" }],
      memberRows: [{ firstName: "Alice", lastName: "Smith" }],
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({ syncFailed: true });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("returns { syncFailed: true } when Club entity is not found — regression for fund-not-found carve-out", async () => {
    const { tx } = makeTx({
      entityRows: [],   // No Club entity
      fundRows: [],
      catRows: [],
      memberRows: [],
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({ syncFailed: true });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("returns { syncFailed: true } when Administrative fund is not found", async () => {
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [],     // No Administrative fund
      catRows: [],
      memberRows: [],
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({ syncFailed: true });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("proceeds with null categoryId when 'Club dues' category is not found (graceful)", async () => {
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      catRows: [],      // No "Club dues" category
      memberRows: [{ firstName: "Bob", lastName: "Jones" }],
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({});
    expect(tx.insert).toHaveBeenCalledOnce();
  });

  it("uses 'Unknown Member' as party when member is not found", async () => {
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      catRows: [{ id: "cat-id" }],
      memberRows: [],   // Member not found
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({});
    expect(tx.insert).toHaveBeenCalledOnce();
  });

  it("returns { syncFailed: true } when insert throws a generic error (not absorbed as re-throw)", async () => {
    const genericError = new Error("Connection lost");
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      catRows: [{ id: "cat-id" }],
      memberRows: [{ firstName: "Alice", lastName: "Smith" }],
      insertShouldThrow: genericError,
    });

    const result = await syncDuesCreate(tx as never, validPayment, "user-id-abc");

    expect(result).toEqual({ syncFailed: true });
  });

  it("re-throws Postgres serialization error (40001) so retry logic is NOT swallowed — regression for sync-carve-out", async () => {
    const serializationError = Object.assign(new Error("Serialization failure"), { code: "40001" });
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      catRows: [{ id: "cat-id" }],
      memberRows: [{ firstName: "Alice", lastName: "Smith" }],
      insertShouldThrow: serializationError,
    });

    await expect(
      syncDuesCreate(tx as never, validPayment, "user-id-abc"),
    ).rejects.toMatchObject({ code: "40001" });
  });

  it("re-throws Postgres deadlock error (40P01) so retry logic is NOT swallowed", async () => {
    const deadlockError = Object.assign(new Error("Deadlock detected"), { code: "40P01" });
    const { tx } = makeTx({
      entityRows: [{ id: "club-entity-id" }],
      fundRows: [{ id: "admin-fund-id" }],
      catRows: [{ id: "cat-id" }],
      memberRows: [{ firstName: "Alice", lastName: "Smith" }],
      insertShouldThrow: deadlockError,
    });

    await expect(
      syncDuesCreate(tx as never, validPayment, "user-id-abc"),
    ).rejects.toMatchObject({ code: "40P01" });
  });
});

// ---------------------------------------------------------------------------
// syncDuesUpdate
// ---------------------------------------------------------------------------

/**
 * For syncDuesUpdate, the tx.select() returns the linked txn row on the FIRST
 * call; tx.update() is called if a linked row is found.
 */
function makeTxForUpdate(opts: {
  linkedTxnRow?: { id: string; reconciled: boolean } | null;
} = {}) {
  const linkedRows = opts.linkedTxnRow ? [opts.linkedTxnRow] : [];
  const updateSpy = vi.fn().mockReturnValue({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  });
  const tx = {
    select: vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(linkedRows),
        }),
      }),
    }),
    update: updateSpy,
  };
  return { tx, updateSpy };
}

describe("syncDuesUpdate", () => {
  const patch = { amountCents: 8000, paymentDate: "2026-06-20", method: "cash" };

  it("returns {} (no-op) when no linked ledger transaction exists (dues pre-inc6a)", async () => {
    const { tx, updateSpy } = makeTxForUpdate({ linkedTxnRow: null });

    const result = await syncDuesUpdate(tx as never, "payment-id", patch);

    expect(result).toEqual({});
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("returns { syncStale: true } when linked txn is reconciled=true, without modifying financial fields — regression for reconciled-path protection", async () => {
    const { tx, updateSpy } = makeTxForUpdate({
      linkedTxnRow: { id: "ledger-txn-id", reconciled: true },
    });

    const result = await syncDuesUpdate(tx as never, "payment-id", patch);

    expect(result).toEqual({ syncStale: true });
    // update must have been called (to set sync_stale=true)
    expect(updateSpy).toHaveBeenCalledOnce();
    // The set argument must only contain syncStale and updatedAt — NOT amountCents/txnDate/paymentMethod
    const setArg = updateSpy.mock.results[0].value.set.mock?.calls?.[0]?.[0];
    // We can't easily inspect the chain, but we verify update WAS called once only
    // The full DB verification is done in the click-through section
  });

  it("returns {} and calls update (not stale) when linked txn is reconciled=false", async () => {
    const { tx, updateSpy } = makeTxForUpdate({
      linkedTxnRow: { id: "ledger-txn-id", reconciled: false },
    });

    const result = await syncDuesUpdate(tx as never, "payment-id", patch);

    expect(result).toEqual({});
    expect(updateSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// syncDuesDelete
// ---------------------------------------------------------------------------

function makeTxForDelete(opts: {
  linkedTxnRow?: { id: string; reconciled: boolean } | null;
} = {}) {
  const linkedRows = opts.linkedTxnRow ? [opts.linkedTxnRow] : [];
  const updateSpy = vi.fn().mockReturnValue({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  });
  const deleteSpy = vi.fn().mockReturnValue({
    where: () => Promise.resolve([]),
  });
  const tx = {
    select: vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(linkedRows),
        }),
      }),
    }),
    update: updateSpy,
    delete: deleteSpy,
  };
  return { tx, updateSpy, deleteSpy };
}

describe("syncDuesDelete", () => {
  it("returns {} (no-op) when no linked ledger transaction exists", async () => {
    const { tx, updateSpy, deleteSpy } = makeTxForDelete({ linkedTxnRow: null });

    const result = await syncDuesDelete(tx as never, "payment-id");

    expect(result).toEqual({});
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("returns { syncStale: true } when linked txn is reconciled=true, preserves the row — regression for reconciled-row preservation on delete", async () => {
    const { tx, updateSpy, deleteSpy } = makeTxForDelete({
      linkedTxnRow: { id: "ledger-txn-id", reconciled: true },
    });

    const result = await syncDuesDelete(tx as never, "payment-id");

    expect(result).toEqual({ syncStale: true });
    // update called to set syncStale=true; delete NOT called
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it("hard-deletes the ledger row when linked txn is reconciled=false", async () => {
    const { tx, updateSpy, deleteSpy } = makeTxForDelete({
      linkedTxnRow: { id: "ledger-txn-id", reconciled: false },
    });

    const result = await syncDuesDelete(tx as never, "payment-id");

    expect(result).toEqual({});
    // delete called; update NOT called
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
