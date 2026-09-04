/**
 * Unit tests for POST /api/admin/email-queue/retry.
 *
 * This is the test named explicitly in the Phase 3 design doc's "Unit Tests
 * To Deliver" (docs/work-log/2026-09-04-event-announcement-emails.md) and in
 * the api-developer task brief: a regression guard for DECISION-092. This
 * route re-sends a PERSISTED email_queue row directly via its own
 * resend.emails.send() call — it bypasses sendEmail() entirely — so if the
 * row's `attachments` column isn't forwarded here, a retried announcement
 * (or any future attachment-bearing send) silently arrives without its
 * calendar invite. That is the exact gap DECISION-092 exists to close.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
const updateSet = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

let eligibleRows: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => eligibleRows,
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({ emailQueue: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeEligibleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "eq-1",
    to: "member@westervillelions.org",
    from: "noreply@westervillelions.org",
    subject: "Weekly Meeting",
    html: "<p>Details</p>",
    status: "failed",
    attempts: 3,
    attachments: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
  sendMock.mockReset().mockResolvedValue({ data: { id: "resend-id" } });
  updateSet.mockReset();
  eligibleRows = [];
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
});

describe("POST /api/admin/email-queue/retry — attachments (DECISION-092)", () => {
  it("forwards a persisted attachments array to resend.emails.send() on retry", async () => {
    const attachments = [
      { filename: "event.ics", content: "BEGIN:VCALENDAR...", contentType: "text/calendar" },
    ];
    eligibleRows = [makeEligibleRow({ attachments })];

    const response = await POST();
    expect(response.status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ attachments }));
  });

  it("a row with attachments: null retries with no attachments key sent", async () => {
    eligibleRows = [makeEligibleRow({ attachments: null })];

    const response = await POST();
    expect(response.status).toBe(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMock.mock.calls[0][0];
    expect(sendArgs).not.toHaveProperty("attachments");
  });
});
