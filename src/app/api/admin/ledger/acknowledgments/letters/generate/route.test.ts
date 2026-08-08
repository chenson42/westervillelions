/**
 * Unit tests for POST /api/admin/ledger/acknowledgments/letters/generate
 * (DECISION-072/073, 2026-08-08). Covers Phase 3's named tests 19-22.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-acknowledgment-letter-queries — importing the real query
 * module would pull in @/lib/db, which throws at import time without
 * DATABASE_URL (see src/lib/ledger-queries.test.ts's header comment for the
 * same rationale). Business-logic behavior (skip reasons, transaction
 * semantics) is covered in ledger-acknowledgment-letter-queries.test.ts;
 * this file only proves the route's own contract: auth/permission gate,
 * body validation, response shape, and single-vs-batch code-path parity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-acknowledgment-letter-queries", () => ({
  generateAcknowledgmentLetters: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { generateAcknowledgmentLetters } from "@/lib/ledger-acknowledgment-letter-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockReset();
  vi.mocked(generateAcknowledgmentLetters).mockReset();
});

describe("POST /api/admin/ledger/acknowledgments/letters/generate — permission gate (Test 19)", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await POST(makeRequest({ ackIds: ["ack-1"] }));

    expect(response.status).toBe(401);
    expect(hasFeature).not.toHaveBeenCalled();
    expect(generateAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks LEDGER_RECORD", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await POST(makeRequest({ ackIds: ["ack-1"] }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.LEDGER_RECORD);
    expect(generateAcknowledgmentLetters).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ledger/acknowledgments/letters/generate — body validation (Test 20)", () => {
  beforeEach(() => {
    vi.mocked(hasFeature).mockResolvedValue(true);
  });

  it("400s when ackIds is missing", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    expect(generateAcknowledgmentLetters).not.toHaveBeenCalled();
  });

  it("400s when ackIds is not an array", async () => {
    const response = await POST(makeRequest({ ackIds: "ack-1" }));
    expect(response.status).toBe(400);
  });

  it("400s when ackIds is an empty array", async () => {
    const response = await POST(makeRequest({ ackIds: [] }));
    expect(response.status).toBe(400);
  });

  it("400s when ackIds contains a non-string entry", async () => {
    const response = await POST(makeRequest({ ackIds: ["ack-1", 42] }));
    expect(response.status).toBe(400);
    expect(generateAcknowledgmentLetters).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ledger/acknowledgments/letters/generate — response shape (Test 21)", () => {
  beforeEach(() => {
    vi.mocked(hasFeature).mockResolvedValue(true);
  });

  it("returns the documented { results: [...] } shape with correct status/reason per row for a mixed batch", async () => {
    vi.mocked(generateAcknowledgmentLetters).mockResolvedValueOnce([
      { ackId: "ack-1", status: "generated", letterText: "Dear Jane..." },
      { ackId: "ack-2", status: "skipped", reason: "no donor linked" },
      { ackId: "ack-3", status: "skipped", reason: "already sent" },
    ]);

    const response = await POST(makeRequest({ ackIds: ["ack-1", "ack-2", "ack-3"] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      results: [
        { ackId: "ack-1", status: "generated", letterText: "Dear Jane..." },
        { ackId: "ack-2", status: "skipped", reason: "no donor linked" },
        { ackId: "ack-3", status: "skipped", reason: "already sent" },
      ],
    });
  });
});

describe("POST /api/admin/ledger/acknowledgments/letters/generate — single vs batch parity (Test 22)", () => {
  beforeEach(() => {
    vi.mocked(hasFeature).mockResolvedValue(true);
  });

  it("a single-item array reaches generateAcknowledgmentLetters the same way a 3-item array does — no divergent code path", async () => {
    vi.mocked(generateAcknowledgmentLetters).mockResolvedValueOnce([
      { ackId: "ack-1", status: "generated", letterText: "text" },
    ]);

    await POST(makeRequest({ ackIds: ["ack-1"] }));

    expect(generateAcknowledgmentLetters).toHaveBeenCalledTimes(1);
    expect(generateAcknowledgmentLetters).toHaveBeenCalledWith(["ack-1"]);

    vi.mocked(generateAcknowledgmentLetters).mockReset();
    vi.mocked(generateAcknowledgmentLetters).mockResolvedValueOnce([
      { ackId: "ack-1", status: "generated", letterText: "text" },
      { ackId: "ack-2", status: "generated", letterText: "text" },
      { ackId: "ack-3", status: "skipped", reason: "not found" },
    ]);

    await POST(makeRequest({ ackIds: ["ack-1", "ack-2", "ack-3"] }));

    // Same function, same call shape (a plain array pass-through) — the
    // route itself has exactly one call site into the write path
    // regardless of batch size.
    expect(generateAcknowledgmentLetters).toHaveBeenCalledWith(["ack-1", "ack-2", "ack-3"]);
  });
});
