/**
 * T21-T22: the move route's gates, body validation and status map
 * (DECISION-109/111). The query layer is mocked: its own behavior is covered in
 * ledger-fund-move-queries.test.ts; this file proves the route is a thin,
 * correctly-gated shell.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-fund-move-queries", () => ({
  previewFundMove: vi.fn(),
  executeFundMove: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { executeFundMove, previewFundMove } from "@/lib/ledger-fund-move-queries";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const GOOD = { destFundId: U1, categoryId: U2, reason: "Zeffy gift booked to the wrong fund", expectedFundId: U3 };

function req(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = (id = ID) => ({ params: Promise.resolve({ id }) });

function grant(...features: string[]) {
  vi.mocked(hasFeature).mockImplementation(async (_u: string, f: string) => features.includes(f));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  grant(FEATURES.LEDGER_RECORD);
});

describe("auth and ids (T21)", () => {
  it("401 when unauthenticated, on both verbs", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(req(), params())).status).toBe(401);
    expect((await POST(req(GOOD), params())).status).toBe(401);
    expect(previewFundMove).not.toHaveBeenCalled();
    expect(executeFundMove).not.toHaveBeenCalled();
  });

  it("403 without LEDGER_RECORD, on both verbs", async () => {
    grant(); // nothing
    expect((await GET(req(), params())).status).toBe(403);
    expect((await POST(req(GOOD), params())).status).toBe(403);
    expect(previewFundMove).not.toHaveBeenCalled();
    expect(executeFundMove).not.toHaveBeenCalled();
  });

  it("a non-uuid id is 404 on both verbs, before any query", async () => {
    expect((await GET(req(), params("nope"))).status).toBe(404);
    expect((await POST(req(GOOD), params("nope"))).status).toBe(404);
    expect(previewFundMove).not.toHaveBeenCalled();
    expect(executeFundMove).not.toHaveBeenCalled();
  });
});

describe("POST body validation (T21)", () => {
  const bad: Array<[string, unknown]> = [
    ["an extra key", { ...GOOD, memo: "x" }],
    ["a fundId key", { ...GOOD, fundId: U1 }],
    ["a missing key", { destFundId: U1, categoryId: U2, reason: GOOD.reason }],
    ["a non-uuid destFundId", { ...GOOD, destFundId: "fund-1" }],
    ["an empty-string categoryId", { ...GOOD, categoryId: "" }],
    ["an empty reason", { ...GOOD, reason: "" }],
    ["a whitespace-only reason", { ...GOOD, reason: "          " }],
    ["a short reason", { ...GOOD, reason: "too short" }],
    ["an over-long reason", { ...GOOD, reason: "a".repeat(501) }],
    ["a non-object body", "hello"],
    ["no body", undefined],
  ];

  it.each(bad)("%s is 400 invalid_body with no query-layer call", async (_n, body) => {
    const res = await POST(req(body), params());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.code).toBe("invalid_body");
    expect(typeof data.error).toBe("string");
    expect(executeFundMove).not.toHaveBeenCalled();
  });

  it("unparseable JSON is 400 invalid_body", async () => {
    const res = await POST(
      { json: async () => { throw new SyntaxError("bad"); } } as unknown as NextRequest,
      params(),
    );
    expect(res.status).toBe(400);
    expect(executeFundMove).not.toHaveBeenCalled();
  });
});

describe("status map and gating (T22)", () => {
  it("passes the parsed input, the actor and the resolved LEDGER_MANAGE boolean to the query layer", async () => {
    grant(FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE);
    vi.mocked(executeFundMove).mockResolvedValue({
      ok: true,
      result: {
        id: ID,
        fundId: U1,
        fundSlug: "activity",
        fundName: "Activity Fund",
        categoryId: U2,
        categoryName: "Public donations",
        sweepSuggested: true,
      },
    });
    const res = await POST(req({ ...GOOD, reason: "  Zeffy gift booked to the wrong fund  " }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ID,
      fundId: U1,
      fundSlug: "activity",
      fundName: "Activity Fund",
      categoryId: U2,
      categoryName: "Public donations",
      sweepSuggested: true,
    });
    expect(executeFundMove).toHaveBeenCalledWith({
      transactionId: ID,
      actorUserId: "user-1",
      callerCanManage: true,
      input: GOOD,
    });
  });

  it("a record-only caller passes callerCanManage: false (the query layer returns manage_required on a reconciled row)", async () => {
    vi.mocked(executeFundMove).mockResolvedValue({
      ok: false,
      status: 403,
      code: "manage_required",
      error: "Moving a reconciled or prior-year entry needs the Manage Ledger permission.",
    });
    const res = await POST(req(GOOD), params());
    expect(vi.mocked(executeFundMove).mock.calls[0][0].callerCanManage).toBe(false);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("manage_required");
  });

  const failures: Array<[number, string]> = [
    [400, "category_invalid"],
    [403, "approved"],
    [403, "away_from_public"],
    [404, "not_found"],
    [404, "fund_not_found"],
    [404, "category_not_found"],
    [409, "stale"],
    [409, "same_fund"],
    [409, "bank_account_entity_mismatch"],
  ];
  it.each(failures)("a %i %s failure maps to that status and { error, code }", async (status, code) => {
    vi.mocked(executeFundMove).mockResolvedValue({ ok: false, status: status as 400, code: code as never, error: "msg" });
    const res = await POST(req(GOOD), params());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: "msg", code });
  });

  it("an unexpected error is a 500 with the fixed message and no leak", async () => {
    vi.mocked(executeFundMove).mockRejectedValue(new Error("connection string leaked"));
    const res = await POST(req(GOOD), params());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not move this entry. Nothing was changed." });
  });

  it("GET returns the preview on success and the same { error, code } shape on refusal", async () => {
    vi.mocked(previewFundMove).mockResolvedValueOnce({ ok: true, preview: { reasonLimits: { min: 10, max: 500 } } as never });
    const ok = await GET(req(), params());
    expect(ok.status).toBe(200);
    expect((await ok.json()).reasonLimits).toEqual({ min: 10, max: 500 });

    vi.mocked(previewFundMove).mockResolvedValueOnce({ ok: false, status: 403, code: "dues_synced", error: "msg" });
    const refused = await GET(req(), params());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "msg", code: "dues_synced" });
  });
});
