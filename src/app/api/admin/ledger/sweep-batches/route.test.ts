/**
 * POST /api/admin/ledger/sweep-batches (create): gate, body validation and the
 * status map. The library is mocked; its behavior is ledger-sweep-batch.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-sweep-batch", () => ({ createSweepBatch: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { createSweepBatch } from "@/lib/ledger-sweep-batch";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const GOOD = {
  sourceIds: [U1, U2],
  sourceBankAccountId: U3,
  destBankAccountId: U1,
  boardMinute: "  Minute 4  ",
  bankAmountCents: 13000,
};

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
  it("401 unauthenticated; 403 Forbidden without ledger.record", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req(GOOD))).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    grant(FEATURES.LEDGER_MANAGE);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(createSweepBatch).not.toHaveBeenCalled();
  });
});

describe("body validation", () => {
  it.each([
    ["no minute", { ...GOOD, boardMinute: undefined }, "minute_required"],
    ["a blank minute", { ...GOOD, boardMinute: "  " }, "minute_required"],
    ["no typed amount", { ...GOOD, bankAmountCents: undefined }, "invalid_amount"],
    ["a fractional amount", { ...GOOD, bankAmountCents: 1.5 }, "invalid_amount"],
    ["a client-chosen fund", { ...GOOD, destFundId: U3 }, "invalid_body"],
    ["a client total", { ...GOOD, totalCents: 13000 }, "invalid_body"],
    ["too many ids", { ...GOOD, sourceIds: Array.from({ length: 201 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`) }, "batch_too_large"],
    ["a short prior-year reason", { ...GOOD, priorYearReason: "short" }, "reason_required"],
    ["no ids", { ...GOOD, sourceIds: [] }, "no_rows"],
  ])("%s is a 400 %s with no library call", async (_n, body, code) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(createSweepBatch).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("201 with the created body; the minute is trimmed; the actor and manage tier are passed", async () => {
    const created = { legId: U1, transferGroupId: U2, copyIds: [U3], status: "posted", totalCents: 13000, count: 2 };
    vi.mocked(createSweepBatch).mockResolvedValue({ ok: true, response: created as never });
    grant(FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE);
    const res = await POST(req({ ...GOOD, priorYearReason: "Gifts held over from the last season" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(created);
    const [input, actor] = vi.mocked(createSweepBatch).mock.calls[0];
    expect(input.boardMinute).toBe("Minute 4");
    expect(input.priorYearReason).toBe("Gifts held over from the last season");
    expect(input.bankAmountCents).toBe(13000);
    expect(actor).toEqual({ userId: "user-1", callerCanManage: true });
  });

  it.each([
    [400, "total_mismatch"],
    [400, "total_too_large"],
    [400, "reason_required"],
    [403, "manage_required"],
    [403, "direction_denied"],
    [404, "fund_not_found"],
    [409, "rows_refused"],
    [409, "rows_claimed"],
  ] as const)("%s %s is passed through with its body", async (status, code) => {
    vi.mocked(createSweepBatch).mockResolvedValue({
      ok: false,
      status,
      body: { error: "x", code, rows: [{ sourceId: U1, code: "already_swept" }] },
    } as never);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(body.rows).toEqual([{ sourceId: U1, code: "already_swept" }]);
  });

  it("an unexpected error is a 500 with a generic message", async () => {
    vi.mocked(createSweepBatch).mockRejectedValue(new Error("deadlock detected"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("deadlock");
    spy.mockRestore();
  });
});
