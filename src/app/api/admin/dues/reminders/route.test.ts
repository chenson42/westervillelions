/**
 * Unit tests for GET/POST /api/admin/dues/reminders.
 *
 * Covers the Phase 3 design doc's "Unit Tests To Deliver" items for this
 * route (docs/work-log/2026-09-25-bulk-send-success-columns.md) — this
 * route had NO test file before B-73.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server,
 * @/lib/dues-reminders-queries, @/lib/dues-queries, @/lib/board-positions,
 * and @/lib/email-durable-claim's sendBulkMemberEmailForDurableClaim (NOT
 * @/lib/email — this route must go through the durable-claim entrypoint,
 * DECISION-102/103).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn() }));
vi.mock("@/lib/dues-queries", () => ({
  listMemberDuesStatus: vi.fn(),
  getDuesSettings: vi.fn(),
}));
vi.mock("@/lib/dues-reminders-queries", () => ({
  getReminderCandidates: vi.fn(),
  insertDuesReminderRows: vi.fn(),
}));
vi.mock("@/lib/email-durable-claim", () => ({ sendBulkMemberEmailForDurableClaim: vi.fn() }));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { resolveTreasurer } from "@/lib/board-positions";
import { listMemberDuesStatus, getDuesSettings } from "@/lib/dues-queries";
import { getReminderCandidates, insertDuesReminderRows } from "@/lib/dues-reminders-queries";
import { sendBulkMemberEmailForDurableClaim } from "@/lib/email-durable-claim";

function makeRequest(opts: { url?: string; body?: unknown } = {}): NextRequest {
  const url = opts.url ?? "http://localhost/api/admin/dues/reminders";
  return {
    nextUrl: new URL(url),
    json: async () => opts.body ?? {},
  } as unknown as NextRequest;
}

const TREASURER = {
  ok: true as const,
  memberId: "treasurer-1",
  firstName: "Terry",
  lastName: "Treasurer",
  email: "treasurer@westervillelions.org",
};

const DUES_SETTINGS = {
  id: "settings-1",
  fiscalYear: 2026,
  individualAmountCents: 12000,
  familyAmountCents: 18000,
  notes: null,
  isActive: true,
};

const M1_STATUS = { memberId: "m-1", status: "unpaid" as const, email: "pat@westervillelions.org", firstName: "Pat", lastName: "Lee", duesCategory: "individual" };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(resolveTreasurer).mockReset().mockResolvedValue(TREASURER);
  vi.mocked(getDuesSettings).mockReset().mockResolvedValue(DUES_SETTINGS as never);
  vi.mocked(listMemberDuesStatus).mockReset().mockResolvedValue([M1_STATUS] as never);
  vi.mocked(getReminderCandidates).mockReset().mockResolvedValue({ unpaid: [], partial: [] });
  vi.mocked(insertDuesReminderRows).mockReset().mockResolvedValue(undefined);
  vi.mocked(sendBulkMemberEmailForDurableClaim).mockReset().mockResolvedValue({
    results: [{ to: "pat@westervillelions.org", outcome: "delivered", emailQueueId: "eq-1" }],
  });
});

describe("GET /api/admin/dues/reminders", () => {
  it("1a. 401s with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await GET(makeRequest({ url: "http://localhost/x?fiscalYear=2026" }));
    expect(response.status).toBe(401);
  });

  it("1b. 403s for a session lacking DUES_MANAGE specifically", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const response = await GET(makeRequest({ url: "http://localhost/x?fiscalYear=2026" }));
    expect(response.status).toBe(403);
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.DUES_MANAGE);
  });

  it("1c. 400s for a missing/non-positive fiscalYear", async () => {
    const response = await GET(makeRequest({ url: "http://localhost/x?fiscalYear=0" }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/admin/dues/reminders", () => {
  const body = { fiscalYear: 2026, memberIds: ["m-1"] };

  it("2a. 401s with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const response = await POST(makeRequest({ body }));
    expect(response.status).toBe(401);
  });

  it("2b. 403s for a session lacking DUES_MANAGE specifically", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const response = await POST(makeRequest({ body }));
    expect(response.status).toBe(403);
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.DUES_MANAGE);
  });

  it("3. 400s when resolveTreasurer() returns ok:false", async () => {
    vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "none" });
    const response = await POST(makeRequest({ body }));
    expect(response.status).toBe(400);
    expect(sendBulkMemberEmailForDurableClaim).not.toHaveBeenCalled();
  });

  it("4. 400s when getDuesSettings(fiscalYear) returns null", async () => {
    vi.mocked(getDuesSettings).mockResolvedValue(null);
    const response = await POST(makeRequest({ body }));
    expect(response.status).toBe(400);
    expect(sendBulkMemberEmailForDurableClaim).not.toHaveBeenCalled();
  });

  it("5. a genuine 'delivered' outcome records success:true, error:null — no-regression case", async () => {
    const response = await POST(makeRequest({ body }));
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.sent).toEqual([
      { memberId: "m-1", email: "pat@westervillelions.org", cohort: "unpaid", success: true },
    ]);

    const insertedRows = vi.mocked(insertDuesReminderRows).mock.calls[0][0];
    expect(insertedRows[0].success).toBe(true);
    expect(insertedRows[0].error).toBeNull();
  });

  it("6. a 'not_delivered'/blocked_non_production outcome records success:false with the exact blocked message — fails against pre-fix code, the actual B-73 regression test", async () => {
    vi.mocked(sendBulkMemberEmailForDurableClaim).mockResolvedValue({
      results: [
        {
          to: "pat@westervillelions.org",
          outcome: "not_delivered",
          reason: "blocked_non_production",
          emailQueueId: "eq-1",
        },
      ],
    });

    const response = await POST(makeRequest({ body }));
    const responseBody = await response.json();
    const expectedError =
      "Blocked — outbound email is disabled outside production (EMAIL_DEV_ALLOWLIST). Nothing was delivered.";

    expect(response.status).toBe(200);
    expect(responseBody.sent).toEqual([
      {
        memberId: "m-1",
        email: "pat@westervillelions.org",
        cohort: "unpaid",
        success: false,
        error: expectedError,
      },
    ]);

    const insertedRows = vi.mocked(insertDuesReminderRows).mock.calls[0][0];
    expect(insertedRows[0].success).toBe(false);
    expect(insertedRows[0].error).toBe(expectedError);
  });

  it("7. a 'not_delivered'/dev_no_api_key outcome records success:false with the dev-no-key message", async () => {
    vi.mocked(sendBulkMemberEmailForDurableClaim).mockResolvedValue({
      results: [
        {
          to: "pat@westervillelions.org",
          outcome: "not_delivered",
          reason: "dev_no_api_key",
          emailQueueId: "eq-1",
        },
      ],
    });

    const response = await POST(makeRequest({ body }));
    const responseBody = await response.json();
    const expectedError =
      "Blocked — no RESEND_API_KEY is configured outside production. Nothing was delivered.";

    expect(response.status).toBe(200);
    expect(responseBody.sent[0]).toEqual({
      memberId: "m-1",
      email: "pat@westervillelions.org",
      cohort: "unpaid",
      success: false,
      error: expectedError,
    });

    const insertedRows = vi.mocked(insertDuesReminderRows).mock.calls[0][0];
    expect(insertedRows[0].success).toBe(false);
    expect(insertedRows[0].error).toBe(expectedError);
  });

  it("8. a 'failed' outcome records success:false with the outcome's own error string — unchanged behavior", async () => {
    vi.mocked(sendBulkMemberEmailForDurableClaim).mockResolvedValue({
      results: [
        { to: "pat@westervillelions.org", outcome: "failed", error: "Resend API error", emailQueueId: "eq-1" },
      ],
    });

    const response = await POST(makeRequest({ body }));
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.sent[0]).toEqual({
      memberId: "m-1",
      email: "pat@westervillelions.org",
      cohort: "unpaid",
      success: false,
      error: "Resend API error",
    });
  });

  it("9. a partial batch (delivered + not_delivered + failed) inserts one row per attempted recipient, each with its own independent outcome", async () => {
    const statuses = [
      { memberId: "m-1", status: "unpaid" as const, email: "pat@westervillelions.org", firstName: "Pat", lastName: "Lee", duesCategory: "individual" },
      { memberId: "m-2", status: "unpaid" as const, email: "sam@westervillelions.org", firstName: "Sam", lastName: "Ng", duesCategory: "individual" },
      { memberId: "m-3", status: "partial" as const, email: "jo@westervillelions.org", firstName: "Jo", lastName: "Kim", duesCategory: "family" },
    ];
    vi.mocked(listMemberDuesStatus).mockResolvedValue(statuses as never);
    vi.mocked(sendBulkMemberEmailForDurableClaim).mockResolvedValue({
      results: [
        { to: "pat@westervillelions.org", outcome: "delivered", emailQueueId: "eq-1" },
        {
          to: "sam@westervillelions.org",
          outcome: "not_delivered",
          reason: "blocked_non_production",
          emailQueueId: "eq-2",
        },
        { to: "jo@westervillelions.org", outcome: "failed", error: "Resend API error", emailQueueId: "eq-3" },
      ],
    });

    const response = await POST(
      makeRequest({ body: { fiscalYear: 2026, memberIds: ["m-1", "m-2", "m-3"] } }),
    );
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.sent).toHaveLength(3);
    const byMember = new Map(responseBody.sent.map((s: { memberId: string }) => [s.memberId, s]));
    expect((byMember.get("m-1") as { success: boolean }).success).toBe(true);
    expect((byMember.get("m-2") as { success: boolean }).success).toBe(false);
    expect((byMember.get("m-3") as { success: boolean }).success).toBe(false);
    expect((byMember.get("m-3") as { error: string }).error).toBe("Resend API error");

    const insertedRows = vi.mocked(insertDuesReminderRows).mock.calls[0][0];
    expect(insertedRows).toHaveLength(3);
  });

  it("10. a recipient missing from the send results still gets an honest, non-null fallback error", async () => {
    vi.mocked(sendBulkMemberEmailForDurableClaim).mockResolvedValue({ results: [] });

    const response = await POST(makeRequest({ body }));
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.sent[0]).toEqual({
      memberId: "m-1",
      email: "pat@westervillelions.org",
      cohort: "unpaid",
      success: false,
      error: "Internal error: no send result recorded for this recipient.",
    });

    const insertedRows = vi.mocked(insertDuesReminderRows).mock.calls[0][0];
    expect(insertedRows[0].success).toBe(false);
    expect(insertedRows[0].error).toBe("Internal error: no send result recorded for this recipient.");
  });
});
