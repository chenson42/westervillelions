/** POST /api/admin/ledger/sweep-batches/closeouts: manage gate, body validation, mark and unmark. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-sweep-batch", () => ({ markSweepCloseouts: vi.fn(), unmarkSweepCloseouts: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { markSweepCloseouts, unmarkSweepCloseouts } from "@/lib/ledger-sweep-batch";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const req = (body?: unknown) => ({ json: async () => body }) as unknown as NextRequest;
function grant(...features: string[]) {
  vi.mocked(hasFeature).mockImplementation(async (_u: string, f: string) => features.includes(f));
}
const MARK = { action: "mark", sourceIds: [U1, U2], reason: "Covered by the earlier lump sweep" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  grant(FEATURES.LEDGER_MANAGE);
});

describe("gate", () => {
  it("401 unauthenticated; 403 Forbidden for ledger.record alone", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req(MARK))).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
    grant(FEATURES.LEDGER_RECORD);
    const res = await POST(req(MARK));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(markSweepCloseouts).not.toHaveBeenCalled();
    expect(unmarkSweepCloseouts).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it.each([
    ["no body", undefined, "invalid_body"],
    ["an unknown action", { ...MARK, action: "delete" }, "invalid_body"],
    ["no ids", { ...MARK, sourceIds: [] }, "invalid_body"],
    ["a non-uuid id", { ...MARK, sourceIds: ["x"] }, "invalid_id"],
    ["too many ids", { ...MARK, sourceIds: Array.from({ length: 201 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`) }, "batch_too_large"],
    ["mark without a reason", { action: "mark", sourceIds: [U1] }, "reason_required"],
    ["mark with a short reason", { ...MARK, reason: "short" }, "reason_required"],
    ["an extra key", { ...MARK, fundId: U1 }, "invalid_body"],
  ])("%s is a 400 %s with no library call", async (_n, body, code) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(markSweepCloseouts).not.toHaveBeenCalled();
    expect(unmarkSweepCloseouts).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("mark calls the mark path with the normalized reason and returns the library result", async () => {
    vi.mocked(markSweepCloseouts).mockResolvedValue({ changed: 1, skipped: [{ sourceId: U2, code: "already_swept" }] });
    const res = await POST(req({ ...MARK, reason: "  Covered by the earlier lump sweep  " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: 1, skipped: [{ sourceId: U2, code: "already_swept" }] });
    expect(markSweepCloseouts).toHaveBeenCalledWith(
      { sourceIds: [U1, U2], reason: "Covered by the earlier lump sweep" },
      { userId: "user-1" },
    );
    expect(unmarkSweepCloseouts).not.toHaveBeenCalled();
  });

  it("unmark needs no reason and calls the unmark path only", async () => {
    vi.mocked(unmarkSweepCloseouts).mockResolvedValue({ changed: 2, skipped: [] });
    const res = await POST(req({ action: "unmark", sourceIds: [U1, U2] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: 2, skipped: [] });
    expect(unmarkSweepCloseouts).toHaveBeenCalledWith({ sourceIds: [U1, U2] }, { userId: "user-1" });
    expect(markSweepCloseouts).not.toHaveBeenCalled();
  });

  it("an unexpected error is a 500", async () => {
    vi.mocked(markSweepCloseouts).mockRejectedValue(new Error("x"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(req(MARK))).status).toBe(500);
    spy.mockRestore();
  });
});
