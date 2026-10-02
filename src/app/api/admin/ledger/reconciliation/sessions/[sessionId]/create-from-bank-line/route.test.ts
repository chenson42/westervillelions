/**
 * T35-T36 (+ the T1 check-number pin): create-from-bank-line (B-108 /
 * DECISION-114). GET returns the advisory candidates; POST answers 409
 * possible_duplicate for a debit that a paid reimbursement may already record
 * unless `acknowledgeDuplicate: true`, inserting NOTHING in the 409 case.
 *
 * Hermetic: auth, permissions and the reconciliation reads are mocked; `@/lib/db`
 * is a per-table queue fake. The REAL candidate finder runs over it, so the
 * route and the mapping (ownRequest, checkNumberMatchesLine) are exercised
 * together; the finder's WHERE shape is pinned in ledger-duplicate-candidates.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/reconciliation-queries", () => ({
  getReconciliationSessionById: vi.fn(),
  getBankLineById: vi.fn(),
  getMatchForBankLine: vi.fn(),
}));

const { st } = vi.hoisted(() => ({
  st: {
    queues: new Map<unknown, unknown[][]>(),
    selectedTables: [] as unknown[],
    inserts: [] as { table: unknown; values: Record<string, unknown> }[],
    transactions: 0,
  },
}));

vi.mock("@/lib/db", () => {
  const handle = {
    select: () => {
      let result: unknown[] = [];
      const chain: Record<string, unknown> = {
        from: (t: unknown) => {
          st.selectedTables.push(t);
          result = st.queues.get(t)?.shift() ?? [];
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        st.inserts.push({ table, values });
        return { returning: () => Promise.resolve([{ id: `new-${st.inserts.length}` }]) };
      },
    }),
  };
  return {
    db: {
      ...handle,
      transaction: async (cb: (t: unknown) => unknown) => {
        st.transactions += 1;
        return cb(handle);
      },
    },
  };
});

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import {
  getBankLineById,
  getMatchForBankLine,
  getReconciliationSessionById,
} from "@/lib/reconciliation-queries";
import {
  ledgerFunds,
  ledgerReimbursements,
  ledgerTransactions,
} from "@/lib/db/schema";

const SESSION = "11111111-1111-4111-8111-111111111111";
const LINE = "22222222-2222-4222-8222-222222222222";
const ACCT = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ sessionId: SESSION }) };

const getReq = (qs = `?bankLineId=${LINE}`): NextRequest =>
  ({ url: `http://localhost/api/x${qs}` }) as unknown as NextRequest;
const postReq = (body: unknown): NextRequest => ({ json: async () => body }) as unknown as NextRequest;

const DEBIT_LINE = {
  id: LINE,
  postingDate: "2026-10-01",
  amountCents: -4500,
  checkOrSlipNumber: "8249",
};
const CREDIT_LINE = { ...DEBIT_LINE, amountCents: 4500 };

const CANDIDATE_ROW = {
  id: "txn-1",
  txnDate: "2026-09-30",
  party: "Pat Member",
  amountCents: 4500,
  checkNumber: null as string | null,
  reconciled: false,
  reconciledSessionId: null,
  bankAccountId: null as string | null,
  fundName: "Administrative Fund",
  bankAccountName: null as string | null,
  matchId: null,
};
const SUBMITTER = {
  id: "r-1",
  transactionId: "txn-1",
  submittedByUserId: "u-sub",
  submittedByMemberId: "m-sub",
};

function q(table: unknown, ...results: unknown[][]) {
  st.queues.set(table, [...(st.queues.get(table) ?? []), ...results]);
}
function queueCandidate(over: Record<string, unknown> = {}) {
  q(ledgerTransactions, [{ ...CANDIDATE_ROW, ...over }]);
  q(ledgerReimbursements, [SUBMITTER]);
}

const BODY = {
  bankLineId: LINE,
  fundId: "fund-1",
  flow: "expense",
  paymentMethod: "check",
};

beforeEach(() => {
  st.queues = new Map();
  st.selectedTables = [];
  st.inserts = [];
  st.transactions = 0;
  vi.mocked(auth).mockResolvedValue({ user: { id: "u-pay", memberId: "m-pay" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getReconciliationSessionById).mockResolvedValue({
    id: SESSION,
    status: "open",
    entityId: "club",
    bankAccountId: ACCT,
  } as never);
  vi.mocked(getBankLineById).mockResolvedValue(DEBIT_LINE as never);
  vi.mocked(getMatchForBankLine).mockResolvedValue(null as never);
  q(ledgerFunds, [{ id: "fund-1", kind: "administrative", entityId: "club" }]);
});

describe("GET candidates (T36)", () => {
  it("401 and 403", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(getReq(), ctx)).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u" } } as never);
    vi.mocked(hasFeature).mockResolvedValue(false);
    expect((await GET(getReq(), ctx)).status).toBe(403);
    expect(getReconciliationSessionById).not.toHaveBeenCalled();
  });

  it("404 for an unknown session, a missing or malformed bankLineId, and an unknown line", async () => {
    vi.mocked(getReconciliationSessionById).mockResolvedValue(null as never);
    expect((await GET(getReq(), ctx)).status).toBe(404);
    vi.mocked(getReconciliationSessionById).mockResolvedValue({ id: SESSION, entityId: "club", bankAccountId: ACCT } as never);
    expect((await GET(getReq(""), ctx)).status).toBe(404);
    expect((await GET(getReq("?bankLineId=nope"), ctx)).status).toBe(404);
    vi.mocked(getBankLineById).mockResolvedValue(null);
    expect((await GET(getReq(), ctx)).status).toBe(404);
  });

  it("a credit line returns an empty list and reads no candidates", async () => {
    vi.mocked(getBankLineById).mockResolvedValue(CREDIT_LINE as never);
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
    expect(st.selectedTables).not.toContain(ledgerTransactions);
  });

  it("returns the candidate shape for a debit line, with needsBankAccount and a check-number match", async () => {
    queueCandidate({ checkNumber: "8249" });
    const res = await GET(getReq(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      candidates: [
        {
          transactionId: "txn-1",
          txnDate: "2026-09-30",
          party: "Pat Member",
          amountCents: 4500,
          fundName: "Administrative Fund",
          bankAccountId: null,
          bankAccountName: null,
          checkNumber: "8249",
          checkNumberMatchesLine: true,
          needsBankAccount: true,
          ownRequest: false,
        },
      ],
    });
  });

  it("a candidate already on the session's account does not need an account; a differing check number does not match", async () => {
    queueCandidate({ bankAccountId: ACCT, bankAccountName: "Checking", checkNumber: "9999" });
    const body = await (await GET(getReq(), ctx)).json();
    expect(body.candidates[0]).toMatchObject({
      needsBankAccount: false,
      bankAccountName: "Checking",
      checkNumberMatchesLine: false,
    });
  });

  it.each([
    ["user id", { id: "u-sub", memberId: "m-other" }],
    ["member id", { id: "u-other", memberId: "m-sub" }],
  ])("ownRequest is true when the caller's %s submitted the reimbursement", async (_n, user) => {
    vi.mocked(auth).mockResolvedValue({ user } as never);
    queueCandidate();
    expect((await (await GET(getReq(), ctx)).json()).candidates[0].ownRequest).toBe(true);
  });
});

describe("POST double-booking guard (T35)", () => {
  it("a debit expense with a candidate is 409 possible_duplicate with the candidates, and NOTHING is inserted", async () => {
    queueCandidate();
    const res = await POST(postReq(BODY), ctx);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("possible_duplicate");
    expect(json.candidates).toHaveLength(1);
    expect(json.candidates[0]).toMatchObject({ transactionId: "txn-1", needsBankAccount: true });
    expect(json.error).toMatch(/count it twice/);
    expect(st.inserts).toHaveLength(0);
    expect(st.transactions).toBe(0);
  });

  it("with acknowledgeDuplicate: true it creates and matches (201), without even asking the finder", async () => {
    const res = await POST(postReq({ ...BODY, acknowledgeDuplicate: true }), ctx);
    expect(res.status).toBe(201);
    expect(st.inserts).toHaveLength(2);
    expect(st.selectedTables).not.toContain(ledgerTransactions);
  });

  it("a non-boolean flag is 400 (a string 'true' is not consent) and inserts nothing", async () => {
    for (const bad of ["true", 1, null, {}]) {
      q(ledgerFunds, [{ id: "fund-1", kind: "administrative", entityId: "club" }]);
      const res = await POST(postReq({ ...BODY, acknowledgeDuplicate: bad }), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("acknowledgeDuplicate must be a boolean");
    }
    expect(st.inserts).toHaveLength(0);
  });

  it("acknowledgeDuplicate: false is the same as absent", async () => {
    queueCandidate();
    expect((await POST(postReq({ ...BODY, acknowledgeDuplicate: false }), ctx)).status).toBe(409);
  });

  it("an income flow is never checked", async () => {
    vi.mocked(getBankLineById).mockResolvedValue(CREDIT_LINE as never);
    const res = await POST(postReq({ ...BODY, flow: "income", party: "Example Donor" }), ctx);
    expect(res.status).toBe(201);
    expect(st.selectedTables).not.toContain(ledgerTransactions);
  });

  it("no candidate is a plain 201 with the bank line's date, amount and the session's account", async () => {
    q(ledgerTransactions, []);
    const res = await POST(postReq(BODY), ctx);
    expect(res.status).toBe(201);
    expect(st.inserts[0].values).toMatchObject({
      txnDate: "2026-10-01",
      amountCents: 4500,
      bankAccountId: ACCT,
      status: "posted",
      flow: "expense",
    });
    expect(await res.json()).toEqual({ transactionId: "new-1", matchId: "new-2" });
  });

  it("every existing validation still runs before the guard (a 400 never becomes a 409)", async () => {
    queueCandidate();
    const res = await POST(postReq({ ...BODY, paymentMethod: "wire" }), ctx);
    expect(res.status).toBe(400);
  });

  it("a 21-character check number is still 400 with the shared message (T1 pin)", async () => {
    const res = await POST(postReq({ ...BODY, checkNumber: "1".repeat(21) }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("checkNumber must not exceed 20 characters");
  });

  it("the ownRequest flag rides along in the 409 body", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-sub", memberId: null } } as never);
    queueCandidate();
    const res = await POST(postReq(BODY), ctx);
    expect((await res.json()).candidates[0].ownRequest).toBe(true);
  });
});
