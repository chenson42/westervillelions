/**
 * Unit tests for POST /api/admin/ledger/transactions.
 *
 * Two describe groups:
 *   1. The original bank-account-required coverage (default-bank-account bug
 *      fix, docs/work-log/2026-07-29-default-bank-account.md) — updated for
 *      the transfer path's new per-leg body shape (sourceBankAccountId /
 *      destBankAccountId replace the single bankAccountId).
 *   2. Full DECISION-058 coverage (Account-to-Account Transfers + Cross-
 *      Entity Sweep, docs/work-log/2026-07-29-ledger-account-transfers.md,
 *      Phase 3 "Unit tests to write" list) — directional allow-list
 *      enforcement, per-leg bank account persistence, boardMinute
 *      requirement, category defaulting, and the over-threshold pending gate
 *      applied to the pair.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db,
 * @/lib/ledger-queries, and @/lib/email — importing the real @/lib/db module
 * throws at import time without DATABASE_URL (see the header comment in
 * src/lib/ledger-queries.test.ts for the same rationale).
 *
 * checkTransferDirection() itself is NOT mocked — the real function
 * (src/lib/ledger-transfer-policy.ts, unit-tested standalone in
 * src/lib/ledger-transfer-policy.test.ts) runs here too, so these tests
 * exercise the real route + real policy integration end to end.
 *
 * DB mock shape: a single FIFO `selectQueue` answers every
 * `db.select(...).from(...).where(...)` call in call order (both the
 * `await ...where(...)` and `await ...where(...).limit(1)` call shapes
 * resolve to the same shifted array) — mirrors the pattern already
 * established in src/lib/ledger-queries.test.ts. `db.transaction(...)`
 * captures the two-row insert `.values()` array for per-leg assertions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  getSettings: vi.fn(),
  getEmailsForFeature: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    insertReturning: [{ id: "txn-1" }] as { id: string }[],
    /** Captured from the LAST db.transaction(...) call's tx.insert(...).values([...]) — the two-leg array. */
    lastTransactionInsertValues: null as Record<string, unknown>[] | null,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    // FIFO queue: each select().from().where() (with or without a trailing
    // .limit()) shifts the next queued result set.
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const rows = mockDbState.selectQueue.shift() ?? [];
          const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
            limit: () => Promise<unknown[]>;
          };
          thenable.limit = () => Promise.resolve(rows);
          return thenable;
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({
        returning: () => Promise.resolve(mockDbState.insertReturning),
      }),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (vals: Record<string, unknown>[] | Record<string, unknown>) => {
            mockDbState.lastTransactionInsertValues = Array.isArray(vals) ? vals : [vals];
            return Promise.resolve(undefined);
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getSettings } from "@/lib/ledger-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const DISB_THRESHOLD_CENTS = 25_000; // $250

const VALID_NORMAL_BODY = {
  entityId: "entity-1",
  fundId: "fund-1",
  txnDate: "2026-07-29",
  flow: "expense" as const,
  amountCents: 1000,
  bankAccountId: "bank-account-1",
};

// ---------------------------------------------------------------------------
// Fund / bank-account / category fixtures shared by the DECISION-058 suite
// ---------------------------------------------------------------------------

const CLUB_ENTITY = "entity-club";
const FOUNDATION_ENTITY = "entity-foundation";

const CLUB_ACTIVITY_FUND = { id: "fund-activity", kind: "activity", entityId: CLUB_ENTITY };
const CLUB_ADMIN_FUND = { id: "fund-admin", kind: "administrative", entityId: CLUB_ENTITY };
const FOUNDATION_CHARITABLE_FUND = {
  id: "fund-charitable",
  kind: "charitable",
  entityId: FOUNDATION_ENTITY,
};

const CLUB_ACTIVITY_BANK = { id: "bank-activity", entityId: CLUB_ENTITY, isActive: true };
const CLUB_ADMIN_CHECKING = { id: "bank-admin-checking", entityId: CLUB_ENTITY, isActive: true };
const CLUB_PETTY_CASH = { id: "bank-petty-cash", entityId: CLUB_ENTITY, isActive: true };
const FOUNDATION_CHECKING = { id: "bank-foundation", entityId: FOUNDATION_ENTITY, isActive: true };
const CLUB_INACTIVE_BANK = { id: "bank-inactive", entityId: CLUB_ENTITY, isActive: false };

const DEFAULT_PUBLIC_DONATIONS_CAT = { id: "cat-public-donations-default" };
const CUSTOM_FOUNDATION_INCOME_CAT = {
  id: "cat-custom",
  entityId: FOUNDATION_ENTITY,
  fundKind: "charitable",
  flow: "income",
};

const VALID_SWEEP_BODY = {
  transfer: true,
  sourceFundId: CLUB_ACTIVITY_FUND.id,
  destFundId: FOUNDATION_CHARITABLE_FUND.id,
  sourceBankAccountId: CLUB_ACTIVITY_BANK.id,
  destBankAccountId: FOUNDATION_CHECKING.id,
  txnDate: "2026-07-29",
  amountCents: 8452,
  boardMinute: "Board approved 2026-07-15, agenda item 4.",
};

const VALID_ACCOUNT_TRANSFER_BODY = {
  transfer: true,
  sourceFundId: CLUB_ADMIN_FUND.id,
  destFundId: CLUB_ADMIN_FUND.id,
  sourceBankAccountId: CLUB_ADMIN_CHECKING.id,
  destBankAccountId: CLUB_PETTY_CASH.id,
  txnDate: "2026-07-29",
  amountCents: 5000,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getSettings).mockResolvedValue({
    disbApprovalThresholdCents: DISB_THRESHOLD_CENTS,
  } as never);
  mockDbState.selectQueue = [];
  mockDbState.insertReturning = [{ id: "txn-1" }];
  mockDbState.lastTransactionInsertValues = null;
});

// ---------------------------------------------------------------------------
// 1. Bank account required (default-bank-account bug fix, updated shape)
// ---------------------------------------------------------------------------

describe("POST /api/admin/ledger/transactions — bank account required (default-bank-account bug fix)", () => {
  it("400s a normal transaction with a missing bankAccountId, with the specific message", async () => {
    const { bankAccountId: _omit, ...body } = VALID_NORMAL_BODY;
    void _omit;
    mockDbState.selectQueue.push([{ id: "fund-1", kind: "administrative", entityId: "entity-1" }]);

    const res = await POST(makeRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
  });

  it("400s a normal transaction with a blank-string bankAccountId", async () => {
    mockDbState.selectQueue.push([{ id: "fund-1", kind: "administrative", entityId: "entity-1" }]);
    const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, bankAccountId: "" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
  });

  it("accepts a normal transaction with a valid bankAccountId (201)", async () => {
    mockDbState.selectQueue.push([{ id: "fund-1", kind: "administrative", entityId: "entity-1" }]);
    const res = await POST(makeRequest(VALID_NORMAL_BODY));
    expect(res.status).toBe(201);
  });

  it("400s a transfer with a missing sourceBankAccountId", async () => {
    const { sourceBankAccountId: _omit, ...body } = VALID_ACCOUNT_TRANSFER_BODY;
    void _omit;

    const res = await POST(makeRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a source bank account before saving this transaction.");
  });

  it("400s a transfer with a missing destBankAccountId", async () => {
    const { destBankAccountId: _omit, ...body } = VALID_ACCOUNT_TRANSFER_BODY;
    void _omit;

    const res = await POST(makeRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a destination bank account before saving this transaction.");
  });

  it("accepts a Transfer with valid, distinct sourceBankAccountId/destBankAccountId (201)", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ADMIN_FUND], // fund lookup (same fund both legs, dedup'd by inArray in real SQL — mock just returns it once)
      [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH], // bank account lookup
    );

    const res = await POST(makeRequest(VALID_ACCOUNT_TRANSFER_BODY));
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 2. DECISION-058 — directional allow-list, board-minute, category, threshold
// ---------------------------------------------------------------------------

describe("POST /api/admin/ledger/transactions — Transfer/Sweep (DECISION-058)", () => {
  it("Sweep with a missing boardMinute → 400, regardless of amount", async () => {
    const { boardMinute: _omit, ...body } = VALID_SWEEP_BODY;
    void _omit;
    mockDbState.selectQueue.push([CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND]);

    const res = await POST(makeRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("A board-minute reference is required for a cross-entity sweep.");
  });

  it("Sweep with a blank (whitespace-only) boardMinute → 400", async () => {
    mockDbState.selectQueue.push([CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND]);

    const res = await POST(makeRequest({ ...VALID_SWEEP_BODY, boardMinute: "   " }));
    expect(res.status).toBe(400);
  });

  it("Sweep under threshold → both legs inserted status='posted', response status:'posted'", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_ACTIVITY_BANK, FOUNDATION_CHECKING],
      [DEFAULT_PUBLIC_DONATIONS_CAT],
    );

    const res = await POST(makeRequest(VALID_SWEEP_BODY)); // amountCents 8452 < threshold 25000
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.status).toBe("posted");
    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.status).toBe("posted");
    expect(destLeg.status).toBe("posted");
  });

  it("Sweep over threshold → both legs inserted status='pending', response status:'pending'", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_ACTIVITY_BANK, FOUNDATION_CHECKING],
      [DEFAULT_PUBLIC_DONATIONS_CAT],
    );

    const res = await POST(makeRequest({ ...VALID_SWEEP_BODY, amountCents: 50_000 }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.status).toBe("pending");
    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.status).toBe("pending");
    expect(destLeg.status).toBe("pending");
  });

  it("Account Transfer over threshold also routes both legs to 'pending' (closes the 'transfers always post' gap)", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

    const res = await POST(makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, amountCents: 50_000 }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.status).toBe("pending");
  });

  it("each leg's bankAccountId matches its own request field, and they differ (per-leg account persistence)", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_ACTIVITY_BANK, FOUNDATION_CHECKING],
      [DEFAULT_PUBLIC_DONATIONS_CAT],
    );

    await POST(makeRequest(VALID_SWEEP_BODY));

    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.bankAccountId).toBe(CLUB_ACTIVITY_BANK.id);
    expect(destLeg.bankAccountId).toBe(FOUNDATION_CHECKING.id);
    expect(sourceLeg.bankAccountId).not.toBe(destLeg.bankAccountId);
  });

  it("Sweep dest leg defaults categoryId to the seeded 'Public donations' category when destCategoryId omitted; source leg stays null", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_ACTIVITY_BANK, FOUNDATION_CHECKING],
      [DEFAULT_PUBLIC_DONATIONS_CAT],
    );

    await POST(makeRequest(VALID_SWEEP_BODY));

    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.categoryId).toBeNull();
    expect(destLeg.categoryId).toBe(DEFAULT_PUBLIC_DONATIONS_CAT.id);
  });

  it("Sweep dest leg uses an explicit destCategoryId when provided (validated against the destination fund)", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_ACTIVITY_BANK, FOUNDATION_CHECKING],
      [CUSTOM_FOUNDATION_INCOME_CAT],
    );

    await POST(makeRequest({ ...VALID_SWEEP_BODY, destCategoryId: CUSTOM_FOUNDATION_INCOME_CAT.id }));

    const [, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(destLeg.categoryId).toBe(CUSTOM_FOUNDATION_INCOME_CAT.id);
  });

  it("same-entity Account Transfer: both legs' categoryId stay null (unchanged behavior)", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

    await POST(makeRequest(VALID_ACCOUNT_TRANSFER_BODY));

    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.categoryId).toBeNull();
    expect(destLeg.categoryId).toBeNull();
  });

  it("same fund + same bank account → 400 no-op (narrowed guard)", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND]);

    const res = await POST(
      makeRequest({
        ...VALID_ACCOUNT_TRANSFER_BODY,
        destBankAccountId: VALID_ACCOUNT_TRANSFER_BODY.sourceBankAccountId,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a different bank account, or transfer to a different fund.");
  });

  it("same fund + different bank account (Admin Checking <-> Petty Cash) → 201, both legs posted, no board minute required", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

    const res = await POST(makeRequest(VALID_ACCOUNT_TRANSFER_BODY));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.status).toBe("posted");
    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.boardMinute).toBeNull();
    expect(destLeg.boardMinute).toBeNull();
  });

  it("blocked direction submitted directly (bypassing the UI) → 400/403 with the specific policy reason", async () => {
    mockDbState.selectQueue.push([CLUB_ACTIVITY_FUND, CLUB_ADMIN_FUND]);

    const res = await POST(
      makeRequest({
        transfer: true,
        sourceFundId: CLUB_ACTIVITY_FUND.id,
        destFundId: CLUB_ADMIN_FUND.id,
        sourceBankAccountId: CLUB_ACTIVITY_BANK.id,
        destBankAccountId: CLUB_ADMIN_CHECKING.id,
        txnDate: "2026-07-29",
        amountCents: 1000,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe(
      "Activity Fund is public-facing pass-through money; it cannot be used to fund Club operations. See Activity Fund policy.",
    );
  });

  it("Foundation -> Club (one-way valve) → blocked regardless of which Club fund is the target", async () => {
    mockDbState.selectQueue.push([FOUNDATION_CHARITABLE_FUND, CLUB_ACTIVITY_FUND]);

    const res = await POST(
      makeRequest({
        transfer: true,
        sourceFundId: FOUNDATION_CHARITABLE_FUND.id,
        destFundId: CLUB_ACTIVITY_FUND.id,
        sourceBankAccountId: FOUNDATION_CHECKING.id,
        destBankAccountId: CLUB_ACTIVITY_BANK.id,
        txnDate: "2026-07-29",
        amountCents: 1000,
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe(
      "Charitable funds cannot be transferred back to the Club — this is a one-way flow by policy.",
    );
  });

  it("bank account belonging to the wrong entity → 400", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      // destBankAccountId points at a Club account, even though destFundId is Foundation's
      [CLUB_ACTIVITY_BANK, CLUB_ADMIN_CHECKING],
    );

    const res = await POST(
      makeRequest({ ...VALID_SWEEP_BODY, destBankAccountId: CLUB_ADMIN_CHECKING.id }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Destination bank account does not belong to the destination fund's entity");
  });

  it("inactive bank account on the source leg → 400", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_INACTIVE_BANK, FOUNDATION_CHECKING],
    );

    const res = await POST(
      makeRequest({ ...VALID_SWEEP_BODY, sourceBankAccountId: CLUB_INACTIVE_BANK.id }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Source bank account is inactive");
  });

  it("inactive bank account on the destination leg → 400", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ADMIN_FUND],
      [CLUB_ADMIN_CHECKING, CLUB_INACTIVE_BANK],
    );

    const res = await POST(
      makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, destBankAccountId: CLUB_INACTIVE_BANK.id }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Destination bank account is inactive");
  });

  it("does NOT accept a client-supplied entityId — both legs' entities are derived from the fund rows", async () => {
    // Even if a client includes an entityId in the body (e.g. an unmigrated
    // client, or a deliberate tamper attempt), it must have zero effect —
    // the route no longer reads it at all.
    mockDbState.selectQueue.push(
      [CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND],
      [CLUB_ACTIVITY_BANK, FOUNDATION_CHECKING],
      [DEFAULT_PUBLIC_DONATIONS_CAT],
    );

    const res = await POST(
      makeRequest({ ...VALID_SWEEP_BODY, entityId: "entity-attacker-supplied" }),
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.entityId).toBe(CLUB_ENTITY);
    expect(destLeg.entityId).toBe(FOUNDATION_ENTITY);
    void data;
  });
});
