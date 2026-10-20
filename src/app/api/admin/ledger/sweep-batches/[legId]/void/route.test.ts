/** POST /api/admin/ledger/sweep-batches/[legId]/void: manage gate, reason and the block map. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-sweep-batch", () => ({ voidSweepBatch: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { voidSweepBatch } from "@/lib/ledger-sweep-batch";

const LEG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const params = (legId = LEG) => ({ params: Promise.resolve({ legId }) });
const req = (body?: unknown) => ({ json: async () => body }) as unknown as NextRequest;
function grant(...features: string[]) {
  vi.mocked(hasFeature).mockImplementation(async (_u: string, f: string) => features.includes(f));
}
const GOOD = { reason: "  Keyed against the wrong bank account  " };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  grant(FEATURES.LEDGER_MANAGE);
});

describe("gate", () => {
  it("401 unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req(GOOD), params())).status).toBe(401);
    expect(voidSweepBatch).not.toHaveBeenCalled();
  });

  it("ledger.record and ledger.approve do not open it; the 403 is identical for existing, missing and malformed ids", async () => {
    grant(FEATURES.LEDGER_RECORD, FEATURES.LEDGER_APPROVE);
    const bodies = [];
    for (const id of [LEG, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "nope"]) {
      const res = await POST(req(GOOD), params(id));
      expect(res.status).toBe(403);
      bodies.push(await res.json());
    }
    expect(bodies).toEqual([{ error: "Forbidden" }, { error: "Forbidden" }, { error: "Forbidden" }]);
    expect(voidSweepBatch).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("a non-uuid id is a 404 after the permission check", async () => {
    const res = await POST(req(GOOD), params("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
    expect(voidSweepBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", undefined],
    ["an empty reason", { reason: "" }],
    ["a short reason", { reason: "too short" }],
    ["a non-string reason", { reason: 5 }],
    ["an over-long reason", { reason: "x".repeat(501) }],
    ["an array body", ["a"]],
  ])("%s is a 400 reason_required with no library call", async (_n, body) => {
    const res = await POST(req(body), params());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("reason_required");
    expect(voidSweepBatch).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("200 passes the trimmed reason and the actor", async () => {
    vi.mocked(voidSweepBatch).mockResolvedValue({ ok: true, response: { voided: true, copiesRemoved: 2, acknowledgmentsRemoved: 0 } });
    const res = await POST(req(GOOD), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voided: true, copiesRemoved: 2, acknowledgmentsRemoved: 0 });
    expect(voidSweepBatch).toHaveBeenCalledWith(LEG, { userId: "user-1" }, "Keyed against the wrong bank account");
  });

  it.each([
    [404, "not_found"],
    [404, "not_a_sweep"],
    [409, "pending_use_reject"],
    [409, "already_rejected"],
    [409, "approved"],
    [409, "reconciled"],
    [409, "matched"],
    [409, "receipt_sent"],
    [409, "prior_fiscal_year"],
    [409, "period_filed"],
  ] as const)("%s %s is passed through", async (status, code) => {
    vi.mocked(voidSweepBatch).mockResolvedValue({ ok: false, status, body: { error: "x", code } });
    const res = await POST(req(GOOD), params());
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it("an unexpected error is a 500", async () => {
    vi.mocked(voidSweepBatch).mockRejectedValue(new Error("copy delete count mismatch"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(req(GOOD), params());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("mismatch");
    spy.mockRestore();
  });
});
