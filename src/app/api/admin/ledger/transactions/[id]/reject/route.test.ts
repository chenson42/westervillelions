/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/reject.
 *
 * The route is a thin wrapper (auth, LEDGER_APPROVE gate, body parsing,
 * response mapping) over decideTransaction(), which is mocked here; the lock,
 * pinned UPDATE, self rule and 409 body are covered in
 * src/lib/ledger-approval-decision.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-approval-decision", () => ({ decideTransaction: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { decideTransaction } from "@/lib/ledger-approval-decision";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const badJsonRequest = {
  json: async () => {
    throw new SyntaxError("Unexpected end of JSON input");
  },
} as unknown as NextRequest;
const params = (id = "txn-1") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "approver-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(decideTransaction).mockReset();
  vi.mocked(decideTransaction).mockResolvedValue({ ok: true, id: "txn-1" });
});

describe("POST .../[id]/reject", () => {
  it("401s when unauthenticated, without deciding", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(makeRequest({ reason: "x" }), params());
    expect(res.status).toBe(401);
    expect(decideTransaction).not.toHaveBeenCalled();
  });

  it("403s without ledger.approve, without deciding", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const res = await POST(makeRequest({ reason: "x" }), params());
    expect(res.status).toBe(403);
    expect(decideTransaction).not.toHaveBeenCalled();
  });

  it("200 returns { id } and passes the actor and input to the helper", async () => {
    const res = await POST(makeRequest({ reason: "x" }), params("txn-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "txn-1" });
    expect(decideTransaction).toHaveBeenCalledWith({
      id: "txn-1",
      actorUserId: "approver-1",
      input: { kind: "reject", reason: "x" },
    });
  });

  it("passes a 409 ApprovalConflictBody through unchanged", async () => {
    const body = {
      error: "Transaction is no longer pending",
      code: "not_pending",
      decision: "approved",
      deciderName: "Pat Example",
      decidedAt: "2026-10-10T15:42:00.000Z",
      decidedByViewer: false,
    };
    vi.mocked(decideTransaction).mockResolvedValue({ ok: false, status: 409, body });
    const res = await POST(makeRequest({ reason: "x" }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(body);
  });

  it.each([
    [400, { error: "reason is required" }],
    [403, { error: "You cannot reject a transaction you recorded" }],
    [404, { error: "Transaction not found", code: "not_found" }],
  ] as const)("maps a helper %i result", async (status, body) => {
    vi.mocked(decideTransaction).mockResolvedValue({ ok: false, status, body });
    const res = await POST(makeRequest({ reason: "x" }), params());
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("malformed JSON becomes the helper's 400, not a 500", async () => {
    vi.mocked(decideTransaction).mockResolvedValue({
      ok: false,
      status: 400,
      body: { error: "reason is required" },
    });
    const res = await POST(badJsonRequest, params());
    expect(res.status).toBe(400);
    expect(decideTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ input: { kind: "reject", reason: undefined } }),
    );
  });

  it("an unexpected throw is a generic 500 with no internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(decideTransaction).mockRejectedValue(new Error("db exploded: secret"));
    const res = await POST(makeRequest({ reason: "x" }), params());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
