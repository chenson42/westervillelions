/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/acknowledge —
 * donor_id sync regression (2026-08-08 bug,
 * docs/work-log/2026-08-08-acknowledgment-donor-link.md).
 *
 * Bug: creating an acknowledgment with a donorId set
 * ledger_acknowledgments.donor_id but never ledger_transactions.donor_id.
 * getDonor() and listPendingAcknowledgments() are both keyed off the
 * TRANSACTION's donor_id, so the donor's giving history and name silently
 * vanished even though the acknowledgment record itself had the donor.
 *
 * Covers:
 *   - creating an acknowledgment WITH a donorId sets donor_id on BOTH the
 *     acknowledgment row and the transaction row, in the same db.transaction()
 *   - creating an acknowledgment WITHOUT a donorId leaves the transaction's
 *     existing donor_id untouched (no update issued)
 *
 * Since 2026-08-12 this file also covers PATCH, which gained a second mode:
 * mode='purpose' edits the gift purpose while the acknowledgment is unsent and
 * is refused (409) once it is sent, while an absent `mode` still means
 * mark-sent. The mode-routing tests exist to pin that separation — the
 * failure worth catching is a purpose edit that quietly marks a donor's
 * acknowledgment delivered, or a mark-sent that quietly rewrites their letter.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db — importing
 * the real @/lib/db module throws at import time without DATABASE_URL (see
 * the header comment in src/lib/ledger-queries.test.ts for the same
 * rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    txnRows: [] as unknown[],
    existingAck: undefined as unknown,
    donor: undefined as unknown,
    txnUpdates: [] as { set: Record<string, unknown> }[],
    ackInsertValues: [] as Record<string, unknown>[],
    // Top-level db.update() calls — PATCH's own writes, distinct from
    // txnUpdates, which are the ones POST issues inside db.transaction().
    ackUpdates: [] as { set: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve(mockDbState.txnRows),
            }),
          }),
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            mockDbState.ackUpdates.push({ set });
            return Promise.resolve([{ id: "ack-1", ...set }]);
          },
        }),
      }),
    })),
    query: {
      ledgerAcknowledgments: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.existingAck)),
      },
      ledgerDonors: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.donor)),
      },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (values: Record<string, unknown>) => ({
            returning: () => {
              mockDbState.ackInsertValues.push(values);
              return Promise.resolve([{ id: "ack-1", ...values }]);
            },
          }),
        }),
        update: () => ({
          set: (set: Record<string, unknown>) => ({
            where: () => {
              mockDbState.txnUpdates.push({ set });
              return Promise.resolve(undefined);
            },
          }),
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST, PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id = "txn-1") {
  return { params: Promise.resolve({ id }) };
}

const FOUNDATION_INCOME_TXN = {
  txn: {
    id: "txn-1",
    flow: "income",
    status: "posted",
    amountCents: 100000, // $1,000 — meets the $250 written-ack threshold
    txnDate: "2026-08-01",
    donorId: null,
  },
  donationsDeductible: true,
  entityName: "Foundation",
  fundName: "Charitable",
};

const DONOR = { id: "donor-1", name: "Trucco Construction Co", email: null };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "recorder-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.txnRows = [FOUNDATION_INCOME_TXN];
  mockDbState.existingAck = undefined;
  mockDbState.donor = DONOR;
  mockDbState.txnUpdates = [];
  mockDbState.ackInsertValues = [];
  mockDbState.ackUpdates = [];
});

describe("POST .../[id]/acknowledge — donor_id sync (2026-08-08 bug)", () => {
  it("creating an acknowledgment WITH a donorId sets donor_id on the transaction too", async () => {
    const res = await POST(makeRequest({ donorId: "donor-1" }), makeParams("txn-1"));
    expect(res.status).toBe(201);

    // The acknowledgment row carries the donor (already worked pre-fix).
    expect(mockDbState.ackInsertValues).toHaveLength(1);
    expect(mockDbState.ackInsertValues[0].donorId).toBe("donor-1");

    // The transaction row must ALSO carry the donor — this is the fix.
    expect(mockDbState.txnUpdates).toHaveLength(1);
    expect(mockDbState.txnUpdates[0].set.donorId).toBe("donor-1");
  });

  it("creating an acknowledgment WITHOUT a donorId does not touch the transaction's donor_id", async () => {
    const res = await POST(makeRequest({}), makeParams("txn-1"));
    expect(res.status).toBe(201);

    expect(mockDbState.ackInsertValues).toHaveLength(1);
    expect(mockDbState.ackInsertValues[0].donorId).toBeNull();

    // No donor supplied — leave whatever is already linked (or not) alone.
    expect(mockDbState.txnUpdates).toHaveLength(0);
  });

  it("re-acknowledging with a different donorId overwrites the transaction's existing link", async () => {
    mockDbState.txnRows = [
      { ...FOUNDATION_INCOME_TXN, txn: { ...FOUNDATION_INCOME_TXN.txn, donorId: "donor-old" } },
    ];

    const res = await POST(makeRequest({ donorId: "donor-1" }), makeParams("txn-1"));
    expect(res.status).toBe(201);

    expect(mockDbState.txnUpdates).toHaveLength(1);
    expect(mockDbState.txnUpdates[0].set.donorId).toBe("donor-1");
  });
});

describe("POST .../[id]/acknowledge — quidProQuoDescription (Acknowledgment Letter Generation, 2026-08-08)", () => {
  it("persists a provided quidProQuoDescription on the acknowledgment row", async () => {
    const res = await POST(
      makeRequest({ quidProQuoValueCents: 10000, quidProQuoDescription: "one Rudolph Run 5K entry" }),
      makeParams("txn-1"),
    );
    expect(res.status).toBe(201);
    expect(mockDbState.ackInsertValues).toHaveLength(1);
    expect(mockDbState.ackInsertValues[0].quidProQuoDescription).toBe("one Rudolph Run 5K entry");
  });

  it("defaults quidProQuoDescription to null when omitted", async () => {
    const res = await POST(makeRequest({}), makeParams("txn-1"));
    expect(res.status).toBe(201);
    expect(mockDbState.ackInsertValues).toHaveLength(1);
    expect(mockDbState.ackInsertValues[0].quidProQuoDescription).toBeNull();
  });

  it("400s when quidProQuoDescription is not a string", async () => {
    const res = await POST(makeRequest({ quidProQuoDescription: 12345 }), makeParams("txn-1"));
    expect(res.status).toBe(400);
  });

  it("400s when quidProQuoDescription exceeds 500 characters", async () => {
    const res = await POST(
      makeRequest({ quidProQuoDescription: "x".repeat(501) }),
      makeParams("txn-1"),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Gift purpose (2026-08-12) —
// docs/work-log/2026-08-12-gift-purpose-on-acknowledgments.md
// ---------------------------------------------------------------------------

const UNSENT_ACK = {
  id: "ack-1",
  donationTxnId: "txn-1",
  sentAt: null,
  purpose: null,
  letterText: null,
};

describe("POST .../[id]/acknowledge — purpose", () => {
  it("persists a provided purpose, trimmed", async () => {
    const res = await POST(
      makeRequest({ purpose: "  the 2026 Rudolph Run  " }),
      makeParams("txn-1"),
    );
    expect(res.status).toBe(201);
    expect(mockDbState.ackInsertValues[0].purpose).toBe("the 2026 Rudolph Run");
  });

  it("defaults purpose to null when omitted", async () => {
    const res = await POST(makeRequest({}), makeParams("txn-1"));
    expect(res.status).toBe(201);
    expect(mockDbState.ackInsertValues[0].purpose).toBeNull();
  });

  it("stores null — never an empty string — for a blank or whitespace-only purpose", async () => {
    // A stored "" would compose the same letter today only because the
    // composer trims; NULL keeps that guarantee in the data, not in a helper.
    for (const blank of ["", "   ", "\n\t "]) {
      mockDbState.ackInsertValues = [];
      const res = await POST(makeRequest({ purpose: blank }), makeParams("txn-1"));
      expect(res.status).toBe(201);
      expect(mockDbState.ackInsertValues[0].purpose).toBeNull();
    }
  });

  it("400s when purpose is not a string", async () => {
    const res = await POST(makeRequest({ purpose: 12345 }), makeParams("txn-1"));
    expect(res.status).toBe(400);
    expect(mockDbState.ackInsertValues).toHaveLength(0);
  });

  it("400s when purpose exceeds 200 characters", async () => {
    const res = await POST(makeRequest({ purpose: "x".repeat(201) }), makeParams("txn-1"));
    expect(res.status).toBe(400);
    expect(mockDbState.ackInsertValues).toHaveLength(0);
  });

  it("accepts a purpose of exactly 200 characters", async () => {
    const res = await POST(makeRequest({ purpose: "x".repeat(200) }), makeParams("txn-1"));
    expect(res.status).toBe(201);
    expect(mockDbState.ackInsertValues[0].purpose).toHaveLength(200);
  });

  it("measures the limit AFTER trimming — padding is not length", async () => {
    const res = await POST(
      makeRequest({ purpose: `   ${"x".repeat(200)}   ` }),
      makeParams("txn-1"),
    );
    expect(res.status).toBe(201);
    expect(mockDbState.ackInsertValues[0].purpose).toHaveLength(200);
  });
});

describe("PATCH .../[id]/acknowledge — mode='purpose'", () => {
  beforeEach(() => {
    mockDbState.existingAck = { ...UNSENT_ACK };
  });

  it("edits the purpose on an UNSENT acknowledgment", async () => {
    const res = await PATCH(
      makeRequest({ mode: "purpose", purpose: "the 2026 Rudolph Run" }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates).toHaveLength(1);
    expect(mockDbState.ackUpdates[0].set.purpose).toBe("the 2026 Rudolph Run");
    // Editing a purpose must never be a covert mark-sent.
    expect(mockDbState.ackUpdates[0].set).not.toHaveProperty("sentAt");
    expect(mockDbState.ackUpdates[0].set).not.toHaveProperty("sentVia");
  });

  it("clears the purpose when given a blank string", async () => {
    mockDbState.existingAck = { ...UNSENT_ACK, purpose: "the 2026 Rudolph Run" };

    const res = await PATCH(makeRequest({ mode: "purpose", purpose: "" }), makeParams("txn-1"));

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates[0].set.purpose).toBeNull();
  });

  it("REFUSES to edit a SENT acknowledgment — 409, no write", async () => {
    // The record of what a donor was told is not revisable. This is the guard
    // the whole mode exists around.
    mockDbState.existingAck = {
      ...UNSENT_ACK,
      sentAt: new Date("2026-08-10T12:00:00Z"),
      purpose: "the 2026 Rudolph Run",
    };

    const res = await PATCH(
      makeRequest({ mode: "purpose", purpose: "something else entirely" }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(409);
    expect(mockDbState.ackUpdates).toHaveLength(0);
    const body = await res.json();
    expect(body.error).toContain("2026-08-10");
  });

  it("404s when no acknowledgment exists for the transaction", async () => {
    mockDbState.existingAck = undefined;

    const res = await PATCH(
      makeRequest({ mode: "purpose", purpose: "the 2026 Rudolph Run" }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(404);
    expect(mockDbState.ackUpdates).toHaveLength(0);
  });

  it("400s on a non-string purpose and on one over 200 characters", async () => {
    const bad = await PATCH(
      makeRequest({ mode: "purpose", purpose: { nope: true } }),
      makeParams("txn-1"),
    );
    expect(bad.status).toBe(400);

    const tooLong = await PATCH(
      makeRequest({ mode: "purpose", purpose: "x".repeat(201) }),
      makeParams("txn-1"),
    );
    expect(tooLong.status).toBe(400);

    expect(mockDbState.ackUpdates).toHaveLength(0);
  });

  it("discards an already-generated letterText when the purpose actually changes", async () => {
    mockDbState.existingAck = {
      ...UNSENT_ACK,
      purpose: "the scholarship fund",
      letterText: "STALE LETTER TEXT",
    };

    const res = await PATCH(
      makeRequest({ mode: "purpose", purpose: "the 2026 Rudolph Run" }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates[0].set.letterText).toBeNull();
    expect((await res.json()).letterTextCleared).toBe(true);
  });

  it("keeps an existing letterText when the purpose is re-saved unchanged", async () => {
    mockDbState.existingAck = {
      ...UNSENT_ACK,
      purpose: "the 2026 Rudolph Run",
      letterText: "GENERATED LETTER TEXT",
    };

    const res = await PATCH(
      makeRequest({ mode: "purpose", purpose: "  the 2026 Rudolph Run  " }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates[0].set).not.toHaveProperty("letterText");
    expect((await res.json()).letterTextCleared).toBe(false);
  });

  it("reports letterTextCleared=false when the purpose changed but no letter existed", async () => {
    mockDbState.existingAck = { ...UNSENT_ACK, purpose: null, letterText: null };

    const res = await PATCH(
      makeRequest({ mode: "purpose", purpose: "the 2026 Rudolph Run" }),
      makeParams("txn-1"),
    );

    expect((await res.json()).letterTextCleared).toBe(false);
  });

  it("401s unauthenticated and 403s without LEDGER_RECORD, before any write", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect((await PATCH(makeRequest({ mode: "purpose", purpose: "x" }), makeParams())).status).toBe(
      401,
    );

    vi.mocked(hasFeature).mockResolvedValueOnce(false);
    expect((await PATCH(makeRequest({ mode: "purpose", purpose: "x" }), makeParams())).status).toBe(
      403,
    );

    expect(mockDbState.ackUpdates).toHaveLength(0);
  });
});

describe("PATCH .../[id]/acknowledge — mode routing", () => {
  beforeEach(() => {
    mockDbState.existingAck = { ...UNSENT_ACK };
  });

  it("an absent mode still means mark-sent — the pre-2026-08-12 default is unchanged", async () => {
    const res = await PATCH(makeRequest({ sentAt: "2026-08-12" }), makeParams("txn-1"));

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates).toHaveLength(1);
    expect(mockDbState.ackUpdates[0].set.sentVia).toBe("print");
    expect(mockDbState.ackUpdates[0].set.sentAt).toBeInstanceOf(Date);
  });

  it("an explicit mode='mark_sent' behaves identically to omitting it", async () => {
    const res = await PATCH(
      makeRequest({ mode: "mark_sent", sentAt: "2026-08-12" }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates[0].set.sentVia).toBe("print");
  });

  it("400s an unrecognized mode rather than falling through to mark-sent", async () => {
    // A typo'd mode must never mark a donor's acknowledgment as delivered.
    const res = await PATCH(makeRequest({ mode: "purpsoe", purpose: "x" }), makeParams("txn-1"));

    expect(res.status).toBe(400);
    expect(mockDbState.ackUpdates).toHaveLength(0);
  });

  it("mark-sent never writes the purpose column, even if one is in the body", async () => {
    const res = await PATCH(
      makeRequest({ sentAt: "2026-08-12", purpose: "sneaky" }),
      makeParams("txn-1"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.ackUpdates[0].set).not.toHaveProperty("purpose");
  });
});
