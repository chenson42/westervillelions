/**
 * Unit tests for POST /api/admin/minutes/[id]/email.
 *
 * Covers Phase 3 design's "Unit Tests for Phase 4" item 6
 * (docs/work-log/2026-08-08-meeting-minutes.md):
 *   - Unmapped kind -> 400, sendEmail() never called.
 *   - general + draft -> 400, sendEmail() never called.
 *   - board + draft -> 200, rendered HTML contains the DRAFT banner text.
 *   - general + approved -> 200, rendered HTML has no DRAFT banner.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server,
 * @/lib/minutes-queries (getMinutesDetail), and @/lib/email (sendEmail).
 * renderMinutesEmailHtml() itself is NOT mocked — the DRAFT-banner
 * assertions exercise the real render module
 * (src/components/admin/minutes/minutes-email-render.tsx), same as
 * src/components/admin/ledger/budget-notes-markdown.test.tsx exercises its
 * real renderer via renderToStaticMarkup() rather than mocking it away.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { MinutesDetail } from "@/lib/minutes-queries";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/minutes-queries", () => ({ getMinutesDetail: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getMinutesDetail } from "@/lib/minutes-queries";
import { sendEmail } from "@/lib/email";

function makeRequest(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeDetail(kind: string, status: string): MinutesDetail {
  return {
    id: "min-1",
    kind,
    eventId: null,
    meetingDate: "2026-06-01",
    status,
    title: null,
    presentCount: null,
    notetakerMemberId: null,
    notetakerNameSnapshot: null,
    bodyMarkdown: "Discussion notes.",
    authorUserId: "user-1",
    approvedByUserId: null,
    approvedAt: null,
    pendingDeleteAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    motions: [],
    actionItems: [],
  };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", email: "notetaker@example.org" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getMinutesDetail).mockReset();
  vi.mocked(sendEmail).mockReset();
});

describe("POST /api/admin/minutes/[id]/email", () => {
  it("Phase 3 test 6a: unmapped kind -> 400, sendEmail() never called", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("committee", "approved"));

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("This minutes kind has no configured recipient.");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("Phase 3 test 6b: general + draft -> 400, sendEmail() never called", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("general", "draft"));

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("This kind can only be emailed once minutes are approved.");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("Phase 3 test 6c: board + draft -> 200, rendered HTML contains the DRAFT banner text", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("board", "draft"));
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" });

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe("board@westervillelions.org");
    expect(call.html).toContain("DRAFT");
    expect(call.html).toContain("subject to approval");
  });

  it("Phase 3 test 6d: general + approved -> 200, rendered HTML has NO DRAFT banner", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("general", "approved"));
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" });

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(200);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.to).toBe("club@westervillelions.org");
    expect(call.html).not.toContain("DRAFT");
  });

  it("board + approved -> 200, still no DRAFT banner (already-official record)", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("board", "approved"));
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" });

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(200);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.html).not.toContain("DRAFT");
  });

  it("DECISION-075 §6: a send FAILURE is surfaced to the caller at 200, not swallowed as a 500 or hidden behind a generic success", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("board", "approved"));
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: "Resend API error", emailQueueId: "eq-1" });

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: "Resend API error", emailQueueId: "eq-1" });
  });

  it("a soft-deleted minutes record 404s rather than emailing a removed record", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue({
      ...makeDetail("board", "approved"),
      pendingDeleteAt: new Date("2026-07-01"),
    });

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("further Phase 4 increment: the notetaker of record renders near the meeting date, and falls back to 'not recorded' when null", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue({
      ...makeDetail("board", "approved"),
      notetakerNameSnapshot: "Jane Doe",
    });
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" });

    const response = await POST(makeRequest(), makeParams("min-1"));

    expect(response.status).toBe(200);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.html).toContain("Recorded by Jane Doe");

    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("board", "approved"));
    const response2 = await POST(makeRequest(), makeParams("min-1"));
    const call2 = vi.mocked(sendEmail).mock.calls[1][0];
    expect(response2.status).toBe(200);
    expect(call2.html).toContain("Recorded by not recorded");
  });

  it("an optional note is passed through and appears in the rendered HTML", async () => {
    vi.mocked(getMinutesDetail).mockResolvedValue(makeDetail("board", "draft"));
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "eq-1" });

    const response = await POST(makeRequest({ note: "Please review before Tuesday." }), makeParams("min-1"));

    expect(response.status).toBe(200);
    const call = vi.mocked(sendEmail).mock.calls[0][0];
    expect(call.html).toContain("Please review before Tuesday.");
  });
});
