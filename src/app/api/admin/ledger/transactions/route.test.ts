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
 *      enforcement, per-leg bank account persistence and the over-threshold
 *      pending gate applied to the pair. The single-amount Sweep was retired by
 *      B-172 Increment 2b: it answers 400 use_sweep_batch (itemized batches are
 *      covered by ledger-sweep-batch.test.ts).
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
  donorExists: vi.fn(),
}));
vi.mock("@/lib/ledger-fund-labels-queries", () => ({
  getFundLabels: vi.fn(async () => ({
    administrative: "Administrative Fund",
    activity: "Public Funds",
    charitable: "Charitable Fund",
    scholarship: "Scholarship Fund",
  })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), sendBulkMemberEmail: vi.fn() }));
vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    insertReturning: [{ id: "txn-1" }] as { id: string }[],
    /** Captured from the LAST single-row db.insert(...).values(...) call. */
    lastInsertValues: null as Record<string, unknown> | null,
    /** Captured from the LAST db.transaction(...) call's tx.insert(...).values([...]) — the two-leg array. */
    lastTransactionInsertValues: null as Record<string, unknown>[] | null,
    /** What the pair insert's .returning() yields; null = one expense and one income row. */
    txReturning: null as { id: string; flow: string }[] | null,
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
      values: (v: Record<string, unknown>) => {
        mockDbState.lastInsertValues = v;
        return { returning: () => Promise.resolve(mockDbState.insertReturning) };
      },
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (vals: Record<string, unknown>[] | Record<string, unknown>) => {
            const arr = Array.isArray(vals) ? vals : [vals];
            mockDbState.lastTransactionInsertValues = arr;
            const result = Promise.resolve(undefined) as Promise<undefined> & {
              returning: () => Promise<{ id: string; flow: string }[]>;
            };
            result.returning = () =>
              Promise.resolve(
                mockDbState.txReturning ??
                  arr.map((v, i) => ({ id: `txn-leg-${i}`, flow: String(v.flow) })),
              );
            return result;
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
import { getSettings, getEmailsForFeature, donorExists } from "@/lib/ledger-queries";
import { sendBulkMemberEmail } from "@/lib/email";
import { resolveTreasurer } from "@/lib/board-positions";
import { db } from "@/lib/db";
import { SWEEP_ERROR_COPY } from "@/lib/ledger-sweep";
import { DEFAULT_FUND_LABELS } from "@/lib/ledger-fund-labels";

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
  bankAccountId: "11111111-1111-4111-8111-111111111111",
};

// ---------------------------------------------------------------------------
// Fund / bank-account / category fixtures shared by the DECISION-058 suite
// ---------------------------------------------------------------------------

const CLUB_ENTITY = "entity-club";
const FOUNDATION_ENTITY = "entity-foundation";

const CLUB_ACTIVITY_FUND = { id: "fund-activity", kind: "activity", entityId: CLUB_ENTITY, name: "Activity Fund" };
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
  vi.mocked(db.insert).mockClear();
  vi.mocked(db.transaction).mockClear();
  vi.mocked(getEmailsForFeature).mockResolvedValue(["approver@example.com"]);
  vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "test" } as never);
  vi.mocked(sendBulkMemberEmail).mockReset();
  vi.mocked(sendBulkMemberEmail).mockResolvedValue(undefined as never);
  mockDbState.selectQueue = [];
  mockDbState.insertReturning = [{ id: "txn-1" }];
  mockDbState.lastTransactionInsertValues = null;
  mockDbState.txReturning = null;
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
    mockDbState.selectQueue.push(
      [{ id: "fund-1", kind: "administrative", entityId: "entity-1" }],
      [{ id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-1", isActive: true }],
    );
    const res = await POST(makeRequest(VALID_NORMAL_BODY));
    expect(res.status).toBe(201);
  });

  // T25 — bankAccountId is validated server-side on the regular path.
  describe("bankAccountId validation (DECISION-109, T25)", () => {
    const FUND = { id: "fund-1", kind: "administrative", entityId: "entity-1" };

    it("400s a malformed bankAccountId with no insert and no bank-account query", async () => {
      mockDbState.selectQueue.push([FUND]);
      const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, bankAccountId: "not-a-uuid" }));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("Select a valid bank account.");
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it("400s a nonexistent bank account (not a foreign-key 500)", async () => {
      mockDbState.selectQueue.push([FUND], []);
      const res = await POST(makeRequest(VALID_NORMAL_BODY));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("Bank account not found.");
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it("400s a bank account that belongs to another entity", async () => {
      mockDbState.selectQueue.push(
        [FUND],
        [{ id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-other", isActive: true }],
      );
      const res = await POST(makeRequest(VALID_NORMAL_BODY));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("Bank account does not belong to this entity.");
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });

    it("400s an inactive bank account", async () => {
      mockDbState.selectQueue.push(
        [FUND],
        [{ id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-1", isActive: false }],
      );
      const res = await POST(makeRequest(VALID_NORMAL_BODY));
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe("Bank account is inactive. Select an active account.");
      expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
    });
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
  it("a Sweep body is refused 400 use_sweep_batch BEFORE the board-minute and bank-account checks (B-172 Inc 2b)", async () => {
    const { boardMinute: _omit, ...body } = VALID_SWEEP_BODY;
    void _omit;
    mockDbState.selectQueue.push([CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND]);

    const res = await POST(makeRequest({ ...body, sourceBankAccountId: "not-a-bank-account" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.code).toBe("use_sweep_batch");
    expect(data.error).toBe(SWEEP_ERROR_COPY.use_sweep_batch(DEFAULT_FUND_LABELS));
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
    expect(mockDbState.lastTransactionInsertValues).toBeNull();
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it.each([8452, 50_000])(
    "a Sweep of %i cents (under or over the threshold) writes no rows and notifies no one",
    async (amountCents) => {
      mockDbState.selectQueue.push([CLUB_ACTIVITY_FUND, FOUNDATION_CHARITABLE_FUND]);

      const res = await POST(makeRequest({ ...VALID_SWEEP_BODY, amountCents }));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe("use_sweep_batch");
      expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
      expect(mockDbState.lastTransactionInsertValues).toBeNull();
      expect(sendBulkMemberEmail).not.toHaveBeenCalled();
    },
  );

  it("Account Transfer over threshold also routes both legs to 'pending' (closes the 'transfers always post' gap)", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

    const res = await POST(makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, amountCents: 50_000 }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.status).toBe("pending");
  });

  it("each leg's bankAccountId matches its own request field, and they differ (per-leg account persistence)", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

    await POST(makeRequest(VALID_ACCOUNT_TRANSFER_BODY));

    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.bankAccountId).toBe(CLUB_ADMIN_CHECKING.id);
    expect(destLeg.bankAccountId).toBe(CLUB_PETTY_CASH.id);
    expect(sourceLeg.bankAccountId).not.toBe(destLeg.bankAccountId);
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
      [CLUB_ADMIN_FUND],
      // destBankAccountId points at a Foundation account, though the dest fund is the Club's
      [CLUB_ADMIN_CHECKING, FOUNDATION_CHECKING],
    );

    const res = await POST(
      makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, destBankAccountId: FOUNDATION_CHECKING.id }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Destination bank account does not belong to the destination fund's entity");
  });

  it("inactive bank account on the source leg → 400", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_INACTIVE_BANK, CLUB_PETTY_CASH]);

    const res = await POST(
      makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, sourceBankAccountId: CLUB_INACTIVE_BANK.id }),
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
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

    const res = await POST(
      makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, entityId: "entity-attacker-supplied" }),
    );

    expect(res.status).toBe(201);
    const [sourceLeg, destLeg] = mockDbState.lastTransactionInsertValues!;
    expect(sourceLeg.entityId).toBe(CLUB_ENTITY);
    expect(destLeg.entityId).toBe(CLUB_ENTITY);
  });
});

// ---------------------------------------------------------------------------
// B-108 / T1 — behavior pin for the shared normalizeCheckNumber migration
// ---------------------------------------------------------------------------

describe("POST /api/admin/ledger/transactions — checkNumber normalizer (T1 pin)", () => {
  const FUND = { id: "fund-1", kind: "administrative", entityId: "entity-1" };
  const BANK = { id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-1", isActive: true };

  it("a 21-character check number is still 400 with the same message", async () => {
    mockDbState.selectQueue.push([FUND], [BANK]);
    const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, checkNumber: "1".repeat(21) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("checkNumber must not exceed 20 characters");
  });

  it("a non-string check number is still 400 with the same message", async () => {
    mockDbState.selectQueue.push([FUND], [BANK]);
    const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, checkNumber: 8249 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("checkNumber must be a string");
  });
});

// ---------------------------------------------------------------------------
// 3. Pending-approval notification (E-1): typed text is escaped
//    (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Increment 1)
// ---------------------------------------------------------------------------

describe("POST /api/admin/ledger/transactions — pending approval email escaping", () => {
  const XSS_PAYEE = "<img src=x onerror=1>";
  const XSS_MEMO = "<script>alert(1)</script>";

  function sentHtml(): string {
    expect(sendBulkMemberEmail).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendBulkMemberEmail).mock.calls[0][0] as {
      recipients: { to: string; html: string }[];
    };
    return arg.recipients[0].html;
  }

  it("over-threshold disbursement: payee and memo are HTML-escaped", async () => {
    mockDbState.selectQueue.push(
      [{ id: "fund-1", kind: "administrative", entityId: "entity-1" }],
      [{ id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-1", isActive: true }],
    );
    const res = await POST(
      makeRequest({ ...VALID_NORMAL_BODY, amountCents: 50_000, party: XSS_PAYEE, memo: XSS_MEMO }),
    );
    expect(res.status).toBe(201);
    const html = sentHtml();
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>Payee:</strong>");
    expect(html).toContain("/admin/ledger/approvals");
  });

  it("over-threshold Transfer: memo is HTML-escaped and there is no Payee line", async () => {
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);
    const res = await POST(
      makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, amountCents: 50_000, memo: XSS_MEMO }),
    );
    expect(res.status).toBe(201);
    const html = sentHtml();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("Payee");
  });
});

describe("POST /api/admin/ledger/transactions — review link and expense-leg id", () => {
  function sentHtml(): string {
    expect(sendBulkMemberEmail).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendBulkMemberEmail).mock.calls[0][0] as {
      recipients: { to: string; html: string }[];
    };
    return arg.recipients[0].html;
  }
  const SENTENCE =
    "Only one board approval is needed to post this. If a colleague has already approved it, the link will show who, and you can add your approval too.";
  const transferQueue = () =>
    mockDbState.selectQueue.push([CLUB_ADMIN_FUND], [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH]);

  it("ordinary over-threshold email links to ?txn=<inserted id> and carries the sentence", async () => {
    mockDbState.selectQueue.push(
      [{ id: "fund-1", kind: "administrative", entityId: "entity-1" }],
      [{ id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-1", isActive: true }],
    );
    const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, amountCents: 50_000 }));
    expect(res.status).toBe(201);
    expect(sentHtml()).toMatch(/href="[^"]*\/admin\/ledger\/approvals\?txn=txn-1"/);
    expect(sentHtml()).toContain(SENTENCE);
  });

  it("an over-threshold Transfer 201 carries the expense-leg id plus the existing fields; the email links to it", async () => {
    mockDbState.txReturning = [
      { id: "leg-income", flow: "income" },
      { id: "leg-expense", flow: "expense" },
    ];
    transferQueue();
    const res = await POST(makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, amountCents: 50_000 }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data).toMatchObject({ id: "leg-expense", status: "pending" });
    expect(typeof data.transferGroupId).toBe("string");
    expect(typeof data.derivedFiscalYear).toBe("number");
    expect(sentHtml()).toMatch(/\/admin\/ledger\/approvals\?txn=leg-expense"/);
    expect(sentHtml()).toContain(SENTENCE);
    expect(vi.mocked(sendBulkMemberEmail).mock.calls[0][0]).toMatchObject({
      subject: "Transfer pending your approval — $500.00",
    });
  });

  it("an under-threshold Transfer still returns the expense-leg id and sends no email", async () => {
    mockDbState.selectQueue.push(
      [CLUB_ADMIN_FUND],
      [CLUB_ADMIN_CHECKING, CLUB_PETTY_CASH],
    );
    mockDbState.txReturning = [{ id: "leg-expense", flow: "expense" }, { id: "leg-income", flow: "income" }];
    const res = await POST(makeRequest(VALID_ACCOUNT_TRANSFER_BODY));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.id).toBe("leg-expense");
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("with no expense row returned, the link is the plain Approvals URL and the send still happens", async () => {
    mockDbState.txReturning = [];
    transferQueue();
    const res = await POST(makeRequest({ ...VALID_ACCOUNT_TRANSFER_BODY, amountCents: 50_000 }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data).not.toHaveProperty("id");
    expect(data.status).toBe("pending");
    expect(sentHtml()).toMatch(/href="[^"]*\/admin\/ledger\/approvals"/);
    expect(sentHtml()).not.toContain("?txn=");
  });
});

// ---------------------------------------------------------------------------
// donorId on create (B-172): income into Public Funds or a Foundation
// charitable fund only
// ---------------------------------------------------------------------------

describe("POST /api/admin/ledger/transactions — donorId on create (B-172)", () => {
  const DONOR_ID = "d0000000-0000-4000-8000-000000000001";
  const BANK = { id: VALID_NORMAL_BODY.bankAccountId, entityId: "entity-1", isActive: true };
  const fund = (kind: string) => ({ id: "fund-1", kind, entityId: "entity-1" });
  const income = (extra: Record<string, unknown> = {}) => ({
    ...VALID_NORMAL_BODY,
    flow: "income" as const,
    party: "Example Donor",
    ...extra,
  });

  beforeEach(() => {
    mockDbState.lastInsertValues = null;
    vi.mocked(donorExists).mockReset();
    vi.mocked(donorExists).mockResolvedValue(true);
    vi.mocked(db.insert).mockClear();
  });

  it.each(["activity", "charitable"])("stores the donor on %s income", async (kind) => {
    mockDbState.selectQueue.push([fund(kind)], [BANK]);

    const res = await POST(makeRequest(income({ donorId: DONOR_ID })));

    expect(res.status).toBe(201);
    expect(mockDbState.lastInsertValues?.donorId).toBe(DONOR_ID);
    expect(donorExists).toHaveBeenCalledWith(DONOR_ID);
  });

  it("an unknown donor is 404 donor_not_found and nothing is inserted", async () => {
    vi.mocked(donorExists).mockResolvedValue(false);
    mockDbState.selectQueue.push([fund("activity")], [BANK]);

    const res = await POST(makeRequest(income({ donorId: DONOR_ID })));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("donor_not_found");
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("expense in a public fund is 400 donor_not_applicable, and the donor is never looked up", async () => {
    mockDbState.selectQueue.push([fund("activity")], [BANK]);

    const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, flow: "expense", donorId: DONOR_ID }));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("donor_not_applicable");
    expect(donorExists).not.toHaveBeenCalled();
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it.each(["administrative", "scholarship"])("income in a %s fund is 400 donor_not_applicable", async (kind) => {
    mockDbState.selectQueue.push([fund(kind)], [BANK]);

    const res = await POST(makeRequest(income({ donorId: DONOR_ID })));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("donor_not_applicable");
    expect(vi.mocked(db.insert)).not.toHaveBeenCalled();
  });

  it("a malformed donorId is 400 before any lookup", async () => {
    mockDbState.selectQueue.push([fund("activity")], [BANK]);

    const res = await POST(makeRequest(income({ donorId: "not-a-uuid" })));

    expect(res.status).toBe(400);
    expect(donorExists).not.toHaveBeenCalled();
  });

  it("omitted or null donorId behaves exactly as before, on any fund and flow", async () => {
    mockDbState.selectQueue.push([fund("administrative")], [BANK]);
    expect((await POST(makeRequest(VALID_NORMAL_BODY))).status).toBe(201);
    expect(mockDbState.lastInsertValues?.donorId).toBeNull();

    mockDbState.selectQueue.push([fund("administrative")], [BANK]);
    expect((await POST(makeRequest({ ...VALID_NORMAL_BODY, donorId: null }))).status).toBe(201);
    expect(donorExists).not.toHaveBeenCalled();
  });
});
