/**
 * Unit tests for POST /api/admin/ledger/reports/send.
 *
 * docs/work-log/2026-09-25-financial-report-auto-send.md, Phase 3 "Unit
 * Tests the Implementer Must Deliver", item 8 (permission gate) plus the
 * route's own status-mapping contract.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/financial-report-send directly — same convention as
 * src/app/api/admin/welcome-packets/route.test.ts. All fingerprint/claim/
 * treasurer-resolution logic is covered separately in
 * src/lib/financial-report-send.test.ts; this file only proves the route's
 * own auth/validation/status-mapping wiring.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/financial-report-send", () => ({ sendMonthlyReportToBoard: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { sendMonthlyReportToBoard } from "@/lib/financial-report-send";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = { entityId: "entity-1", month: "2026-09" };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(sendMonthlyReportToBoard).mockReset();
});

describe("POST /api/admin/ledger/reports/send", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(sendMonthlyReportToBoard).not.toHaveBeenCalled();
  });

  it("returns 403 when the session lacks ledger.report_send, even though it could view the reports page", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(403);
    expect(sendMonthlyReportToBoard).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_month when entityId is missing", async () => {
    const response = await POST(makeRequest({ month: "2026-09" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("invalid_month");
    expect(sendMonthlyReportToBoard).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_month when month is missing", async () => {
    const response = await POST(makeRequest({ entityId: "entity-1" }));

    expect(response.status).toBe(400);
    expect(sendMonthlyReportToBoard).not.toHaveBeenCalled();
  });

  it("passes entityId, month, and the session's own user id through to sendMonthlyReportToBoard", async () => {
    vi.mocked(sendMonthlyReportToBoard).mockResolvedValue({
      ok: true,
      emailQueueId: "eq-1",
      sentAt: "2026-09-25T00:00:00.000Z",
      corrected: false,
    });

    await POST(makeRequest(VALID_BODY));

    expect(sendMonthlyReportToBoard).toHaveBeenCalledWith("entity-1", "2026-09", "user-1");
  });

  it("returns 200 with the send result on success", async () => {
    vi.mocked(sendMonthlyReportToBoard).mockResolvedValue({
      ok: true,
      emailQueueId: "eq-1",
      sentAt: "2026-09-25T00:00:00.000Z",
      corrected: true,
    });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      emailQueueId: "eq-1",
      sentAt: "2026-09-25T00:00:00.000Z",
      corrected: true,
    });
  });

  it.each([
    ["not_found", 404],
    ["invalid_month", 400],
    ["not_ready", 409],
    ["already_sent", 409],
    ["treasurer_unresolved", 422],
    ["send_failed", 502],
    // Distinct from send_failed: sendEmail() never attempted delivery — the
    // non-production deny-by-default guard refused it (docs/work-log/
    // 2026-09-25-financial-report-auto-send.md follow-up).
    ["blocked_non_production", 503],
  ] as const)("maps reason %s to status %d", async (reason, status) => {
    vi.mocked(sendMonthlyReportToBoard).mockResolvedValue({ ok: false, reason });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(status);
    expect(json.error).toBe(reason);
  });

  it("includes detail when the failure carries one", async () => {
    vi.mocked(sendMonthlyReportToBoard).mockResolvedValue({
      ok: false,
      reason: "treasurer_unresolved",
      detail: "none",
    });

    const response = await POST(makeRequest(VALID_BODY));
    const json = await response.json();

    expect(json.detail).toBe("none");
  });
});
