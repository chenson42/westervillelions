/**
 * POST /api/admin/ledger/sweep-batches/preview: gate, body validation and the
 * status map. The library is mocked (its own suite is ledger-sweep-batch.test.ts);
 * this proves the route is a thin, correctly-gated shell.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-sweep-batch", () => ({ previewSweepBatch: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { previewSweepBatch } from "@/lib/ledger-sweep-batch";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const GOOD = { sourceIds: [U1, U2], sourceBankAccountId: U3, destBankAccountId: U1 };

const req = (body?: unknown) => ({ json: async () => body }) as unknown as NextRequest;
function grant(...features: string[]) {
  vi.mocked(hasFeature).mockImplementation(async (_u: string, f: string) => features.includes(f));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  grant(FEATURES.LEDGER_RECORD);
});

describe("gate", () => {
  it("401 when unauthenticated, before any feature check or library call", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req(GOOD))).status).toBe(401);
    expect(hasFeature).not.toHaveBeenCalled();
    expect(previewSweepBatch).not.toHaveBeenCalled();
  });

  it("403 Forbidden without ledger.record (view, manage and approve alone do not open it)", async () => {
    grant(FEATURES.LEDGER_VIEW, FEATURES.LEDGER_APPROVE);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(previewSweepBatch).not.toHaveBeenCalled();
  });
});

describe("body validation", () => {
  it.each([
    ["no body", undefined, "invalid_body"],
    ["an extra key", { ...GOOD, destFundId: U3 }, "invalid_body"],
    ["no ids", { ...GOOD, sourceIds: [] }, "no_rows"],
    ["a non-uuid id", { ...GOOD, sourceIds: ["x"] }, "invalid_id"],
    ["a duplicate id", { ...GOOD, sourceIds: [U1, U1] }, "duplicate_ids"],
    ["a bad bank account", { ...GOOD, sourceBankAccountId: "x" }, "bank_account_invalid"],
    ["an impossible date", { ...GOOD, sweepDate: "2026-02-31" }, "invalid_date"],
    ["a bad typed amount", { ...GOOD, bankAmountCents: -5 }, "invalid_amount"],
  ])("%s is a 400 %s with no library call", async (_n, body, code) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(previewSweepBatch).not.toHaveBeenCalled();
  });

  it("unparseable JSON is a 400 invalid_body", async () => {
    const res = await POST({ json: async () => { throw new SyntaxError("bad"); } } as unknown as NextRequest);
    expect(res.status).toBe(400);
    expect(previewSweepBatch).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("passes the parsed request, defaults the sweep date, and resolves callerCanManage from the feature", async () => {
    vi.mocked(previewSweepBatch).mockResolvedValue({ ok: true, response: { rows: [] } as never });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    const [input, actor] = vi.mocked(previewSweepBatch).mock.calls[0];
    expect(input).toMatchObject({ sourceIds: [U1, U2], sourceBankAccountId: U3, destBankAccountId: U1 });
    expect(input.sweepDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(actor).toEqual({ callerCanManage: false });

    grant(FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE);
    await POST(req({ ...GOOD, sweepDate: "2026-10-19" }));
    expect(vi.mocked(previewSweepBatch).mock.calls[1][1]).toEqual({ callerCanManage: true });
    expect(vi.mocked(previewSweepBatch).mock.calls[1][0].sweepDate).toBe("2026-10-19");
  });

  it.each([
    [403, "direction_denied"],
    [404, "fund_not_found"],
    [400, "bank_account_invalid"],
  ] as const)("a library failure %s %s is passed through with its body", async (status, code) => {
    vi.mocked(previewSweepBatch).mockResolvedValue({ ok: false, status, body: { error: "x", code } } as never);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it("an unexpected error is a 500 with no internal detail", async () => {
    vi.mocked(previewSweepBatch).mockRejectedValue(new Error("connection refused at 10.0.0.1"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.1");
    spy.mockRestore();
  });
});
