/**
 * T21: the HTTP layer of POST/GET .../transactions/[id]/correct (B-108 /
 * DECISION-114). The evaluator and execute path are tested in
 * ledger-reimbursement-correction-queries.test.ts; here the queries module is
 * mocked so the route's own order is pinned: auth, permission before anything
 * else, uuid, body shape before any database work, result-to-status mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-reimbursement-correction-queries", () => ({
  previewCorrection: vi.fn(),
  executeCorrection: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  executeCorrection,
  previewCorrection,
} from "@/lib/ledger-reimbursement-correction-queries";
import {
  CORRECTION_ERROR_STATUS,
  type CorrectionErrorCode,
} from "@/lib/ledger-reimbursement-correction";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BANK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ISO = "2026-10-01T12:00:00.123Z";
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const postReq = (body: unknown): NextRequest =>
  ({
    json: async () => {
      if (body === "THROW") throw new SyntaxError("bad json");
      return body;
    },
    url: `http://localhost/api/admin/ledger/transactions/${ID}/correct`,
  }) as unknown as NextRequest;
const getReq = (qs = ""): NextRequest =>
  ({ url: `http://localhost/api/admin/ledger/transactions/${ID}/correct${qs}` }) as unknown as NextRequest;

const FILL = { operation: "fill_bank_account", bankAccountId: BANK, expectedUpdatedAt: ISO };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "u-1", memberId: "m-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(previewCorrection).mockReset();
  vi.mocked(executeCorrection).mockReset();
});

describe.each([
  ["GET", () => GET(getReq(), params())],
  ["POST", () => POST(postReq(FILL), params())],
])("%s gate", (_verb, call) => {
  it("401 with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await call()).status).toBe(401);
    expect(previewCorrection).not.toHaveBeenCalled();
    expect(executeCorrection).not.toHaveBeenCalled();
  });

  it("403 forbidden BEFORE any row read, asking for LEDGER_RECORD", async () => {
    vi.mocked(hasFeature).mockImplementation(async (_u, f) => f === FEATURES.LEDGER_MANAGE);
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
    expect(hasFeature).toHaveBeenCalledWith("u-1", FEATURES.LEDGER_RECORD);
    expect(previewCorrection).not.toHaveBeenCalled();
    expect(executeCorrection).not.toHaveBeenCalled();
  });
});

describe("POST", () => {
  it("a non-uuid id is 404 with no database work", async () => {
    const res = await POST(postReq(FILL), params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
    expect(executeCorrection).not.toHaveBeenCalled();
  });

  it.each([
    ["an unparseable body", "THROW"],
    ["a null body", null],
    ["an unknown operation", { operation: "nuke" }],
    ["an unexpected key", { ...FILL, amountCents: 1 }],
    ["a stale-tab body with no token", { operation: "fill_bank_account", bankAccountId: BANK }],
  ])("%s is 400 invalid_body before any database work", async (_n, body) => {
    const res = await POST(postReq(body), params());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
    expect(executeCorrection).not.toHaveBeenCalled();
  });

  it("passes the actor, the tier capability and the parsed input through, and returns the result", async () => {
    vi.mocked(executeCorrection).mockResolvedValue({
      ok: true,
      result: { id: ID, operation: "fill_bank_account", changed: ["bankAccountId"], bankAccountName: "Checking", budgetLineLinkCleared: false, warnings: [] },
    });
    const res = await POST(postReq({ ...FILL, checkNumber: " 8249 " }), params());
    expect(res.status).toBe(200);
    expect((await res.json()).bankAccountName).toBe("Checking");
    expect(executeCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: ID,
        actor: { userId: "u-1", memberId: "m-1" },
        callerCanManage: true,
        input: { operation: "fill_bank_account", bankAccountId: BANK, checkNumber: "8249", expectedUpdatedAt: ISO },
      }),
    );
    expect(hasFeature).toHaveBeenCalledWith("u-1", FEATURES.LEDGER_MANAGE);
  });

  it("callerCanManage is false without LEDGER_MANAGE", async () => {
    vi.mocked(hasFeature).mockImplementation(async (_u, f) => f === FEATURES.LEDGER_RECORD);
    vi.mocked(executeCorrection).mockResolvedValue({ ok: false, status: 403, code: "manage_required", error: "x" });
    await POST(postReq(FILL), params());
    expect(executeCorrection).toHaveBeenCalledWith(expect.objectContaining({ callerCanManage: false }));
  });

  const refusals = (Object.keys(CORRECTION_ERROR_STATUS) as CorrectionErrorCode[]).filter(
    (c) => c !== "forbidden" && c !== "invalid_body",
  );
  it.each(refusals)("maps refusal %s to its pinned status and carries the code", async (code) => {
    vi.mocked(executeCorrection).mockResolvedValue({
      ok: false,
      status: CORRECTION_ERROR_STATUS[code] as 400 | 403 | 404 | 409,
      code,
      error: `msg for ${code}`,
    });
    const res = await POST(postReq(FILL), params());
    expect(res.status).toBe(CORRECTION_ERROR_STATUS[code]);
    expect(await res.json()).toEqual({ error: `msg for ${code}`, code });
  });

  it("a thrown error is a 500 with a generic message and no internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(executeCorrection).mockRejectedValue(new Error("connection string leaked"));
    const res = await POST(postReq(FILL), params());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("connection string");
  });
});

describe("GET", () => {
  it("a non-uuid id is 404", async () => {
    expect((await GET(getReq(), params("nope"))).status).toBe(404);
    expect(previewCorrection).not.toHaveBeenCalled();
  });

  it("a malformed proposal is 400 invalid_body", async () => {
    for (const qs of ["?txnDate=2026-02-31", "?paymentMethod=zelle", "?txnDate=nope"]) {
      const res = await GET(getReq(qs), params());
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_body");
    }
    expect(previewCorrection).not.toHaveBeenCalled();
  });

  it("returns the preview and forwards the proposal", async () => {
    const preview = { transaction: { id: ID } };
    vi.mocked(previewCorrection).mockResolvedValue({ ok: true, preview } as never);
    const res = await GET(getReq("?txnDate=2026-09-12&paymentMethod=cash"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(preview);
    expect(previewCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: ID,
        proposal: { txnDate: "2026-09-12", paymentMethod: "cash" },
        actor: { userId: "u-1", memberId: "m-1" },
      }),
    );
  });

  it("top-level refusals are 4xx with a code", async () => {
    vi.mocked(previewCorrection).mockResolvedValue({ ok: false, status: 403, code: "own_request", error: "no" });
    const res = await GET(getReq(), params());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("own_request");
  });
});
