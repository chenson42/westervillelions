/**
 * Unit tests for POST /api/admin/ledger/acknowledgments/letters/email
 * (Emailing the Donor Acknowledgment Letter, 2026-08-12, DECISION-087/088).
 * Covers Phase 3's named tests 14-15.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-acknowledgment-letter-queries — importing the real query
 * module would pull in @/lib/db, which throws at import time without
 * DATABASE_URL (mirrors .../letters/generate/route.test.ts's own header
 * comment / rationale). Business-logic behavior (the atomic claim,
 * revert-on-failure, index-zipped result grouping) is covered in
 * ledger-acknowledgment-letter-queries.test.ts; this file only proves the
 * route's own contract: auth/permission gate, body validation, and
 * response shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-acknowledgment-letter-queries", () => ({
  emailAcknowledgmentLetters: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { emailAcknowledgmentLetters } from "@/lib/ledger-acknowledgment-letter-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockReset();
  vi.mocked(emailAcknowledgmentLetters).mockReset();
});

describe("POST /api/admin/ledger/acknowledgments/letters/email — permission gate + body validation (Test 14)", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await POST(makeRequest({ ackIds: ["ack-1"] }));

    expect(response.status).toBe(401);
    expect(hasFeature).not.toHaveBeenCalled();
    expect(emailAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks LEDGER_RECORD", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await POST(makeRequest({ ackIds: ["ack-1"] }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.LEDGER_RECORD);
    expect(emailAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("400s when ackIds is missing", async () => {
    vi.mocked(hasFeature).mockResolvedValue(true);

    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(emailAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("400s when ackIds is not an array", async () => {
    vi.mocked(hasFeature).mockResolvedValue(true);

    const response = await POST(makeRequest({ ackIds: "ack-1" }));

    expect(response.status).toBe(400);
    expect(emailAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("400s when ackIds is an empty array", async () => {
    vi.mocked(hasFeature).mockResolvedValue(true);

    const response = await POST(makeRequest({ ackIds: [] }));

    expect(response.status).toBe(400);
    expect(emailAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("400s when ackIds contains a non-string entry", async () => {
    vi.mocked(hasFeature).mockResolvedValue(true);

    const response = await POST(makeRequest({ ackIds: ["ack-1", 42] }));

    expect(response.status).toBe(400);
    expect(emailAcknowledgmentLetters).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ledger/acknowledgments/letters/email — response shape (Test 15)", () => {
  beforeEach(() => {
    vi.mocked(hasFeature).mockResolvedValue(true);
  });

  it("returns the documented { results: [...] } shape for a mixed batch (one emailed, one skipped, one failed)", async () => {
    vi.mocked(emailAcknowledgmentLetters).mockResolvedValueOnce([
      {
        ackId: "ack-1",
        status: "emailed",
        addresses: [{ to: "donor@example.com", success: true }],
      },
      { ackId: "ack-2", status: "skipped", reason: "donor has no email on file" },
      {
        ackId: "ack-3",
        status: "failed",
        reason: "delivery failed for all addresses — not marked sent, safe to retry",
      },
    ]);

    const response = await POST(makeRequest({ ackIds: ["ack-1", "ack-2", "ack-3"] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      results: [
        {
          ackId: "ack-1",
          status: "emailed",
          addresses: [{ to: "donor@example.com", success: true }],
        },
        { ackId: "ack-2", status: "skipped", reason: "donor has no email on file" },
        {
          ackId: "ack-3",
          status: "failed",
          reason: "delivery failed for all addresses — not marked sent, safe to retry",
        },
      ],
    });
    expect(emailAcknowledgmentLetters).toHaveBeenCalledWith(["ack-1", "ack-2", "ack-3"]);
  });

  it("500s on an unexpected throw from emailAcknowledgmentLetters()", async () => {
    vi.mocked(emailAcknowledgmentLetters).mockRejectedValueOnce(new Error("db exploded"));

    const response = await POST(makeRequest({ ackIds: ["ack-1"] }));

    expect(response.status).toBe(500);
  });
});
