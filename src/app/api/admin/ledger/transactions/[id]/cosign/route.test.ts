/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/cosign.
 *
 * A thin wrapper (auth, LEDGER_APPROVE gate, response mapping) over
 * cosignTransaction(), which is mocked; the lock, eligibility and INSERT are
 * covered in src/lib/ledger-cosign.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-cosign", () => ({ cosignTransaction: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { cosignTransaction } from "@/lib/ledger-cosign";
import { isCosignConflict, isCosignForbidden } from "@/lib/ledger-approval";

const makeRequest = (body?: unknown) =>
  ({ json: async () => body }) as unknown as NextRequest;
const params = (id = "txn-1") => ({ params: Promise.resolve({ id }) });
const WHEN = new Date("2026-10-10T16:00:00Z");

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(hasFeature).mockReset();
  vi.mocked(auth).mockResolvedValue({ user: { id: "approver-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(cosignTransaction).mockReset();
  vi.mocked(cosignTransaction).mockResolvedValue({ ok: true, id: "txn-1", cosignedAt: WHEN });
});

describe("POST .../[id]/cosign", () => {
  it("401s when unauthenticated, without co-signing", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(401);
    expect(cosignTransaction).not.toHaveBeenCalled();
  });

  it("403s without ledger.approve, with NO code, without co-signing", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
    expect("code" in body).toBe(false);
    expect(isCosignForbidden(body)).toBe(false);
    expect(cosignTransaction).not.toHaveBeenCalled();
  });

  it("checks ledger.approve for the session user, auth before the helper", async () => {
    await POST(makeRequest(), params());
    expect(hasFeature).toHaveBeenCalledWith("approver-1", "ledger.approve");
    const authOrder = vi.mocked(auth).mock.invocationCallOrder[0];
    const gateOrder = vi.mocked(hasFeature).mock.invocationCallOrder[0];
    const helperOrder = vi.mocked(cosignTransaction).mock.invocationCallOrder[0];
    expect(authOrder).toBeLessThan(gateOrder);
    expect(gateOrder).toBeLessThan(helperOrder);
  });

  it("201 returns { id, cosignedAt } with an ISO time", async () => {
    const res = await POST(makeRequest(), params("txn-1"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "txn-1", cosignedAt: WHEN.toISOString() });
  });

  it("ignores a request body: the helper receives the SESSION user id", async () => {
    await POST(makeRequest({ userId: "someone-else", actorUserId: "someone-else" }), params("txn-9"));
    expect(cosignTransaction).toHaveBeenCalledWith({ id: "txn-9", actorUserId: "approver-1" });
  });

  it("does not read the body at all", async () => {
    const json = vi.fn();
    await POST({ json } as unknown as NextRequest, params());
    expect(json).not.toHaveBeenCalled();
  });

  it("maps a recorder refusal to 403 with code recorded_by_you, distinct from the permission 403", async () => {
    vi.mocked(cosignTransaction).mockResolvedValue({
      ok: false,
      status: 403,
      body: { error: "You recorded this entry", code: "recorded_by_you" },
    });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(403);
    expect(isCosignForbidden(await res.json())).toBe(true);
  });

  it("maps 404 through", async () => {
    vi.mocked(cosignTransaction).mockResolvedValue({
      ok: false,
      status: 404,
      body: { error: "Transaction not found", code: "not_found" },
    });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Transaction not found", code: "not_found" });
  });

  it.each([
    "not_approved",
    "rejected",
    "not_board_decision",
    "already_approved",
    "already_cosigned",
  ] as const)("passes a 409 %s body through unchanged", async (code) => {
    const body = { error: "x", code, at: "2026-10-09T12:00:00.000Z", deciderName: null };
    vi.mocked(cosignTransaction).mockResolvedValue({ ok: false, status: 409, body });
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(409);
    const out = await res.json();
    expect(out).toEqual(body);
    expect(isCosignConflict(out)).toBe(true);
  });

  it("500s with a generic message when the helper throws (no internals leaked)", async () => {
    vi.mocked(cosignTransaction).mockRejectedValue(new Error("connection refused 10.0.0.1"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest(), params());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.1");
    spy.mockRestore();
  });
});
