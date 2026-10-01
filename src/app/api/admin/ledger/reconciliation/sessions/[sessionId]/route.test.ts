/**
 * Unit tests for DELETE .../sessions/[sessionId]
 * (docs/work-log/2026-10-01-discard-reconciliation-session.md, R1-R8).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/reconciliation-queries", () => ({
  getReconciliationSessionById: vi.fn(),
  getBankLinesForSession: vi.fn(),
  getCandidateTransactionsForMatching: vi.fn(),
  getTieOutAssembly: vi.fn(),
  discardOpenSession: vi.fn(),
}));

import { DELETE } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { discardOpenSession } from "@/lib/reconciliation-queries";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const mockAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const mockHasFeature = vi.mocked(hasFeature);
const mockDiscard = vi.mocked(discardOpenSession);

function call(sessionId = SESSION_ID) {
  return DELETE({} as NextRequest, { params: Promise.resolve({ sessionId }) });
}

function grant(features: string[]) {
  mockHasFeature.mockImplementation(async (_u: string, f: string) => features.includes(f));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER_ID } });
  grant([FEATURES.LEDGER_RECORD]);
});

describe("DELETE reconciliation session", () => {
  it("R1: 401 with no session; discard not called", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it("R2: 403 without ledger.record; feature checked before discard; discard not called", async () => {
    grant([]);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockHasFeature).toHaveBeenCalledWith(USER_ID, FEATURES.LEDGER_RECORD);
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it("R3: non-UUID id -> 404; discard not called", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it("R4: not_found -> 404 'Session not found'", async () => {
    mockDiscard.mockResolvedValue({ outcome: "not_found" });
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Session not found" });
  });

  it("R5: not_open -> 409 exact message", async () => {
    mockDiscard.mockResolvedValue({ outcome: "not_open" });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This session is closed — reopen it before discarding it.",
    });
  });

  it("R6: two-key rule — record-only passes canManage false; requires_manage -> 403; manager passes true -> 200", async () => {
    mockDiscard.mockResolvedValue({ outcome: "requires_manage" });
    let res = await call();
    expect(mockDiscard).toHaveBeenLastCalledWith({
      sessionId: SESSION_ID,
      actorUserId: USER_ID,
      canManage: false,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only a ledger manager can discard a session that was reopened.",
    });

    grant([FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE]);
    mockDiscard.mockResolvedValue({
      outcome: "discarded",
      sessionId: SESSION_ID,
      bankLineCount: 1,
      matchCount: 1,
    });
    res = await call();
    expect(mockDiscard).toHaveBeenLastCalledWith({
      sessionId: SESSION_ID,
      actorUserId: USER_ID,
      canManage: true,
    });
    expect(res.status).toBe(200);
  });

  it("R7: 200 body is exactly { sessionId, discarded, bankLineCount, matchCount }", async () => {
    mockDiscard.mockResolvedValue({
      outcome: "discarded",
      sessionId: SESSION_ID,
      bankLineCount: 42,
      matchCount: 17,
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessionId: SESSION_ID,
      discarded: true,
      bankLineCount: 42,
      matchCount: 17,
    });
  });

  it("R8: thrown error -> 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDiscard.mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to discard reconciliation session" });
    spy.mockRestore();
  });
});
