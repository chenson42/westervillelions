/** GET /api/admin/ledger/sweep-batches/[legId]: gate (any of four keys), ids and the no-PII body. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { marker: "db" } }));
vi.mock("@/lib/ledger-sweep-batch", () => ({ getSweepBatchDetail: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getSweepBatchDetail } from "@/lib/ledger-sweep-batch";

const LEG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const params = (legId = LEG) => ({ params: Promise.resolve({ legId }) });
const req = () => ({}) as unknown as NextRequest;
function grant(...features: string[]) {
  vi.mocked(hasFeature).mockImplementation(async (_u: string, f: string) => features.includes(f));
}

const DETAIL = {
  legId: LEG, status: "pending", sweepDate: "2026-10-19", boardMinute: "Minute 4", recordedBy: "Pat Treasurer",
  count: 2, totalCents: 13000, byCategory: [{ name: "White Cane", count: 2, cents: 13000 }],
  fiscalYears: [2026], approved: false, reconciled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  grant(FEATURES.LEDGER_VIEW);
});

describe("gate", () => {
  it("401 unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(req(), params())).status).toBe(401);
    expect(getSweepBatchDetail).not.toHaveBeenCalled();
  });

  it.each([FEATURES.LEDGER_VIEW, FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE, FEATURES.LEDGER_APPROVE])(
    "%s alone opens it",
    async (feature) => {
      grant(feature);
      vi.mocked(getSweepBatchDetail).mockResolvedValue(DETAIL as never);
      expect((await GET(req(), params())).status).toBe(200);
    },
  );

  it("403 Forbidden is identical for an existing id, a missing id and a non-uuid, and never reaches the library", async () => {
    grant(FEATURES.LEDGER_REPORT_SEND);
    vi.mocked(getSweepBatchDetail).mockResolvedValue(DETAIL as never);
    const bodies = [];
    for (const id of [LEG, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "not-a-uuid"]) {
      const res = await GET(req(), params(id));
      expect(res.status).toBe(403);
      bodies.push(await res.json());
    }
    expect(bodies[0]).toEqual({ error: "Forbidden" });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(getSweepBatchDetail).not.toHaveBeenCalled();
  });
});

describe("responses", () => {
  it("a non-uuid id is a 404 after the permission check, with no query", async () => {
    const res = await GET(req(), params("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
    expect(getSweepBatchDetail).not.toHaveBeenCalled();
  });

  it("an unknown id or a leg that is not a sweep is the same 404", async () => {
    vi.mocked(getSweepBatchDetail).mockResolvedValue(null);
    const res = await GET(req(), params());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });

  it("200 returns the detail with no party, memo or donor key", async () => {
    vi.mocked(getSweepBatchDetail).mockResolvedValue(DETAIL as never);
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DETAIL);
    expect(Object.keys(body).join(" ")).not.toMatch(/party|memo|donor/i);
    expect(vi.mocked(getSweepBatchDetail).mock.calls[0][1]).toBe(LEG);
  });

  it("an unexpected error is a 500", async () => {
    vi.mocked(getSweepBatchDetail).mockRejectedValue(new Error("x"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await GET(req(), params())).status).toBe(500);
    spy.mockRestore();
  });
});
