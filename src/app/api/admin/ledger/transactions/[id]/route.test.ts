/**
 * Unit tests for PATCH /api/admin/ledger/transactions/[id]. Covers:
 *
 *   - the bank-account-immutability fix for Transfer/Sweep pairs
 *     (DECISION-058, docs/work-log/2026-07-29-ledger-account-transfers.md):
 *     prior to that fix, `?both=true` force-applied an edited `bankAccountId`
 *     to BOTH legs of a transfer pair — correct under the old same-entity,
 *     one-bank-account-per-pair invariant, but silent data corruption the
 *     moment a pair can legitimately have two different bankAccountId values
 *     (an Account Transfer or a cross-entity Sweep). Fix: bankAccountId is
 *     silently ignored (not 400ed) for ANY row with a non-null
 *     transferGroupId, regardless of the `both` query param.
 *
 *   - the reconciled-lock donor-link carve-out (DECISION-099,
 *     docs/work-log/2026-09-21-reconciled-donor-link-carveout.md Phase 3,
 *     named tests 8-17): a request whose body's key set is EXACTLY
 *     `{ donorId }` now passes the reconciled-row lock; anything else — an
 *     unrelated field alone, or donorId bundled with any other field — still
 *     403s exactly as before. approvedAt/rejected guards are untouched by
 *     the carve-out. The transfer-pair `?both=true` branch is skipped
 *     entirely for a carve-out-shaped edit. A successful carve-out edit
 *     writes one attributed ledgerAuditLog row; an ordinary edit on a
 *     non-reconciled row writes none.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db, and
 * @/lib/receipt-storage — importing the real @/lib/db module throws at
 * import time without DATABASE_URL (see the header comment in
 * src/lib/ledger-queries.test.ts for the same rationale). @/lib/db/schema is
 * imported directly (real, unmocked) purely for table-reference identity —
 * it does not touch a DB connection at import time (only src/lib/db/index.ts
 * does), same pattern as src/lib/ledger-category-queries.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/receipt-storage", () => ({
  RECEIPT_KEY_REGEX: /^receipts\/.+$/,
  getReceiptStorage: vi.fn(() => ({ delete: vi.fn(() => Promise.resolve()) })),
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    existing: null as Record<string, unknown> | null,
    /** Answers the partner-group select in the ?both=true + transferGroupId branch, and any other non-donor select (funds/categories). */
    partnerRows: [] as Record<string, unknown>[],
    /** Answers the donor-existence select (`db.select(...).from(ledgerDonors)...`) specifically. */
    donorRows: [] as Record<string, unknown>[],
    updates: [] as { set: Record<string, unknown> }[],
    inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      ledgerTransactions: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.existing)),
      },
    },
    select: vi.fn(() => ({
      from: (table: unknown) => {
        // `ledgerDonors` below is the real, unmocked @/lib/db/schema export —
        // the same module instance route.ts itself imports — so this
        // identity check is safe even though this closure is defined inside
        // the @/lib/db mock factory: it isn't evaluated until a test
        // actually invokes PATCH(), by which point every module in the
        // graph (including this file's own `ledgerDonors` import below) is
        // fully resolved.
        const rows = table === ledgerDonors ? mockDbState.donorRows : mockDbState.partnerRows;
        const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>;
        };
        thenable.limit = () => Promise.resolve(rows);
        return {
          where: () => thenable,
        };
      },
    })),
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          mockDbState.updates.push({ set });
          return Promise.resolve(undefined);
        },
      }),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        update: () => ({
          set: (set: Record<string, unknown>) => ({
            where: () => {
              mockDbState.updates.push({ set });
              return Promise.resolve(undefined);
            },
          }),
        }),
        insert: (table: unknown) => ({
          values: (values: Record<string, unknown>) => {
            mockDbState.inserts.push({ table, values });
            return Promise.resolve(undefined);
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { ledgerAuditLog, ledgerDonors } from "@/lib/db/schema";

function makeRequest(body: unknown, url: string): NextRequest {
  return { json: async () => body, url } as unknown as NextRequest;
}
function makeParams(id = "txn-source") {
  return { params: Promise.resolve({ id }) };
}

const BASE_URL = "http://localhost/api/admin/ledger/transactions/txn-source";

const SWEEP_SOURCE_LEG = {
  id: "txn-source",
  entityId: "entity-club",
  fundId: "fund-activity",
  flow: "expense",
  transferGroupId: "group-1",
  approvedAt: null,
  status: "pending",
  reconciledSessionId: null,
  receiptStorageKey: null,
};

const SWEEP_DEST_LEG = {
  id: "txn-dest",
  approvedAt: null,
  reconciledSessionId: null,
};

const ORDINARY_TXN = {
  id: "txn-ordinary",
  entityId: "entity-club",
  fundId: "fund-admin",
  flow: "expense",
  transferGroupId: null,
  approvedAt: null,
  status: "posted",
  reconciledSessionId: null,
  receiptStorageKey: null,
};

const RECONCILED_TXN = {
  id: "txn-reconciled",
  entityId: "entity-club",
  fundId: "fund-admin",
  flow: "expense",
  transferGroupId: null,
  approvedAt: null,
  status: "posted",
  reconciledSessionId: "session-1",
  receiptStorageKey: null,
  donorId: null,
  budgetLineId: null,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.existing = null;
  mockDbState.partnerRows = [];
  mockDbState.donorRows = [];
  mockDbState.updates = [];
  mockDbState.inserts = [];
});

describe("PATCH .../[id] — bank-account immutability for Transfer/Sweep pairs (DECISION-058)", () => {
  it("editing a Sweep pair's amount/date/memo via ?both=true no longer touches bankAccountId on either leg even if the request body includes one", async () => {
    mockDbState.existing = { ...SWEEP_SOURCE_LEG };
    mockDbState.partnerRows = [SWEEP_DEST_LEG];

    const res = await PATCH(
      makeRequest(
        {
          amountCents: 6000,
          txnDate: "2026-08-01",
          memo: "updated memo",
          bankAccountId: "bank-attempted-change",
        },
        `${BASE_URL}?both=true`,
      ),
      makeParams("txn-source"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(2);
    const [targetUpdate, partnerUpdate] = mockDbState.updates;

    // amount/date/memo DID apply to both legs...
    expect(targetUpdate.set.amountCents).toBe(6000);
    expect(targetUpdate.set.txnDate).toBe("2026-08-01");
    expect(targetUpdate.set.memo).toBe("updated memo");
    expect(partnerUpdate.set.amountCents).toBe(6000);
    expect(partnerUpdate.set.txnDate).toBe("2026-08-01");
    expect(partnerUpdate.set.memo).toBe("updated memo");

    // ...but bankAccountId was NOT propagated to either leg's update payload.
    expect("bankAccountId" in targetUpdate.set).toBe(false);
    expect("bankAccountId" in partnerUpdate.set).toBe(false);
  });

  it("attempting to change bankAccountId on a single Sweep/Transfer leg WITHOUT ?both=true is also silently ignored (immutable post-creation for any pair)", async () => {
    mockDbState.existing = { ...SWEEP_SOURCE_LEG };

    const res = await PATCH(
      makeRequest({ memo: "just a memo edit", bankAccountId: "bank-attempted-change" }, BASE_URL),
      makeParams("txn-source"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
    expect("bankAccountId" in mockDbState.updates[0].set).toBe(false);
    expect(mockDbState.updates[0].set.memo).toBe("just a memo edit");
  });

  it("regression: an ordinary (non-pair) transaction's bankAccountId can still be changed normally", async () => {
    mockDbState.existing = { ...ORDINARY_TXN };

    const res = await PATCH(
      makeRequest({ bankAccountId: "bank-new" }, BASE_URL),
      makeParams("txn-ordinary"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
    expect(mockDbState.updates[0].set.bankAccountId).toBe("bank-new");
  });

  it("regression: a blank/missing bankAccountId on a non-pair transaction still 400s", async () => {
    mockDbState.existing = { ...ORDINARY_TXN };

    const res = await PATCH(makeRequest({ bankAccountId: "" }, BASE_URL), makeParams("txn-ordinary"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
    expect(mockDbState.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reconciled-lock donor-link carve-out (DECISION-099) — Phase 3 named tests
// 8-17 (docs/work-log/2026-09-21-reconciled-donor-link-carveout.md).
// ---------------------------------------------------------------------------

describe("PATCH .../[id] — reconciled-lock donor-link carve-out (DECISION-099)", () => {
  it("test 8: a reconciled row accepts a donorId-only PATCH — 200, donorId updated", async () => {
    mockDbState.existing = { ...RECONCILED_TXN };
    mockDbState.donorRows = [{ id: "donor-1" }];

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-1" },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );

    expect(res.status).toBe(200);
    const txnUpdate = mockDbState.updates.find((u) => "donorId" in u.set);
    expect(txnUpdate?.set.donorId).toBe("donor-1");
  });

  it("test 9: a reconciled row accepts donorId: null (unlink) — 200, donorId cleared", async () => {
    mockDbState.existing = { ...RECONCILED_TXN, donorId: "donor-old" };

    const res = await PATCH(
      makeRequest(
        { donorId: null },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );

    expect(res.status).toBe(200);
    const txnUpdate = mockDbState.updates.find((u) => "donorId" in u.set);
    expect(txnUpdate?.set.donorId).toBeNull();
  });

  it("test 10: a reconciled row rejects donorId bundled with amountCents — 403, the WHOLE request fails, nothing applied", async () => {
    mockDbState.existing = { ...RECONCILED_TXN };
    mockDbState.donorRows = [{ id: "donor-1" }];

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-1", amountCents: 100 },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe(
      "This transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row",
    );
    expect(mockDbState.updates).toHaveLength(0);
    expect(mockDbState.inserts).toHaveLength(0);
  });

  it("test 11: a reconciled row rejects an unrelated field alone (categoryId) — still 403", async () => {
    mockDbState.existing = { ...RECONCILED_TXN };

    const res = await PATCH(
      makeRequest(
        { categoryId: "cat-1" },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );

    expect(res.status).toBe(403);
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("test 12: an APPROVED row (also reconciled) still 403s a donorId-only PATCH — the approvedAt guard fires before the carve-out is ever reached", async () => {
    mockDbState.existing = {
      ...RECONCILED_TXN,
      approvedAt: new Date("2026-08-01T00:00:00Z"),
    };

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-1" },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Approved transactions cannot be edited");
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("test 13: a REJECTED row (also reconciled) still 403s a donorId-only PATCH — the rejected guard fires before the carve-out is ever reached", async () => {
    mockDbState.existing = { ...RECONCILED_TXN, status: "rejected" };

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-1" },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe("Rejected transactions cannot be edited");
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("test 14: a successful carve-out edit writes exactly one attributed ledgerAuditLog row", async () => {
    mockDbState.existing = {
      ...RECONCILED_TXN,
      donorId: "donor-old",
      reconciledSessionId: "session-42",
    };
    mockDbState.donorRows = [{ id: "donor-new" }];

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-new" },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );

    expect(res.status).toBe(200);
    const auditInserts = mockDbState.inserts.filter((i) => i.table === ledgerAuditLog);
    expect(auditInserts).toHaveLength(1);
    const row = auditInserts[0].values;
    expect(row.action).toBe("donor_linked_on_reconciled_transaction");
    expect(row.targetTransactionId).toBe("txn-reconciled");
    expect(row.actorUserId).toBe("user-1");
    expect(JSON.parse(row.before as string)).toEqual({ donorId: "donor-old" });
    expect(JSON.parse(row.after as string)).toEqual({ donorId: "donor-new" });
    expect(row.details).toContain("session-42");
  });

  it("test 15: a non-reconciled row's donorId edit is unchanged from today's behavior — 200, no audit row", async () => {
    mockDbState.existing = { ...RECONCILED_TXN, reconciledSessionId: null };
    mockDbState.donorRows = [{ id: "donor-1" }];

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-1" },
        "http://localhost/api/admin/ledger/transactions/txn-reconciled",
      ),
      makeParams("txn-reconciled"),
    );

    expect(res.status).toBe(200);
    const txnUpdate = mockDbState.updates.find((u) => "donorId" in u.set);
    expect(txnUpdate?.set.donorId).toBe("donor-1");
    expect(mockDbState.inserts).toHaveLength(0);
  });

  it("test 16: a carve-out edit on a reconciled transfer leg skips the transfer-pair branch entirely, even with ?both=true — 200, not the partner's 403, partner never touched", async () => {
    mockDbState.existing = {
      ...RECONCILED_TXN,
      id: "txn-transfer-source",
      transferGroupId: "group-recon",
      reconciledSessionId: "session-1",
    };
    mockDbState.donorRows = [{ id: "donor-1" }];
    // The partner leg is ALSO reconciled — if the transfer-pair branch ran
    // despite the carve-out, this would 403 ("The paired transfer
    // transaction was cleared by a closed reconciliation session..."). A 200
    // here is only possible if that branch was never entered.
    mockDbState.partnerRows = [
      { id: "txn-transfer-dest", approvedAt: null, reconciledSessionId: "session-1" },
    ];

    const res = await PATCH(
      makeRequest(
        { donorId: "donor-1" },
        "http://localhost/api/admin/ledger/transactions/txn-transfer-source?both=true",
      ),
      makeParams("txn-transfer-source"),
    );

    expect(res.status).toBe(200);
    // Single-row path only: the requested row's update + the acknowledgment
    // donor-link update. No third update (a symmetric partner-leg update)
    // ever appears — proving the partner was never touched.
    expect(mockDbState.updates).toHaveLength(2);
    expect(mockDbState.updates.every((u) => u.set.donorId === "donor-1")).toBe(true);
  });

  it("test 17: regression — a non-reconciled transfer leg's ?both=true bundle (amountCents + donorId) still takes the transfer-pair path unchanged", async () => {
    mockDbState.existing = { ...SWEEP_SOURCE_LEG, donorId: null };
    mockDbState.partnerRows = [SWEEP_DEST_LEG];
    mockDbState.donorRows = [{ id: "donor-1" }];

    const res = await PATCH(
      makeRequest({ amountCents: 6000, donorId: "donor-1" }, `${BASE_URL}?both=true`),
      makeParams("txn-source"),
    );

    expect(res.status).toBe(200);
    // Both legs' amountCents update still fired — the new `&& !carveout`
    // clause changes nothing here: this body isn't carve-out-shaped (donorId
    // bundled with amountCents), so carveout is false regardless, exactly as
    // it was before this feature existed.
    const legUpdates = mockDbState.updates.filter((u) => "amountCents" in u.set);
    expect(legUpdates).toHaveLength(2);
    expect(legUpdates[0].set.amountCents).toBe(6000);
    expect(legUpdates[1].set.amountCents).toBe(6000);
  });
});
