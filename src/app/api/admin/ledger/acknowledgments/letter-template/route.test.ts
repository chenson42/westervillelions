/**
 * Unit tests for PATCH /api/admin/ledger/acknowledgments/letter-template
 * (DECISION-072/073, 2026-08-08). Covers Phase 3's named tests 23-24.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-acknowledgment-letter-queries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-acknowledgment-letter-queries", () => ({
  updateLetterTemplate: vi.fn(),
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { updateLetterTemplate } from "@/lib/ledger-acknowledgment-letter-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockReset();
  vi.mocked(updateLetterTemplate).mockReset();
});

describe("PATCH /api/admin/ledger/acknowledgments/letter-template — permission gate (Test 23)", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await PATCH(makeRequest({ greeting: "Dear {{donorName}}," }));

    expect(response.status).toBe(401);
    expect(hasFeature).not.toHaveBeenCalled();
    expect(updateLetterTemplate).not.toHaveBeenCalled();
  });

  it("403s with only LEDGER_RECORD (no LEDGER_MANAGE) — proves the stricter gate on template edits", async () => {
    // The route checks LEDGER_MANAGE specifically, not LEDGER_RECORD — a
    // caller who holds LEDGER_RECORD (enough to generate/print letters)
    // but not LEDGER_MANAGE must still be refused here, because a template
    // edit reshapes every future letter club-wide.
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await PATCH(makeRequest({ greeting: "Dear {{donorName}}," }));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(hasFeature).toHaveBeenCalledWith("user-1", FEATURES.LEDGER_MANAGE);
    expect(updateLetterTemplate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/ledger/acknowledgments/letter-template — success (Test 24)", () => {
  beforeEach(() => {
    vi.mocked(hasFeature).mockResolvedValue(true);
  });

  it("200s with LEDGER_MANAGE; response echoes the updated row", async () => {
    const updatedTemplate = {
      id: "template-1",
      greeting: "Dear {{donorName}} — thank you!",
      bodyText: "Thank you for your gift.",
      closing: "With gratitude,",
      signatureName: "Jane Treasurer",
      signatureTitle: "Treasurer, Westerville Lions Club Foundation",
      updatedByUserId: "user-1",
      updatedAt: new Date("2026-08-08"),
      createdAt: new Date("2026-01-01"),
    };
    vi.mocked(updateLetterTemplate).mockResolvedValueOnce(updatedTemplate as never);

    const response = await PATCH(
      makeRequest({ greeting: "Dear {{donorName}} — thank you!" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    // Response body is JSON-round-tripped, so Date fields arrive as
    // ISO strings — compare against a JSON-serialized expectation.
    expect(body.template).toEqual(JSON.parse(JSON.stringify(updatedTemplate)));
    expect(updateLetterTemplate).toHaveBeenCalledWith(
      { greeting: "Dear {{donorName}} — thank you!" },
      "user-1",
    );
  });

  it("400s when no recognized fields are provided", async () => {
    const response = await PATCH(makeRequest({ notARealField: "x" }));
    expect(response.status).toBe(400);
    expect(updateLetterTemplate).not.toHaveBeenCalled();
  });

  it("400s when a provided field is not a string", async () => {
    const response = await PATCH(makeRequest({ greeting: 12345 }));
    expect(response.status).toBe(400);
    expect(updateLetterTemplate).not.toHaveBeenCalled();
  });

  it("400s when a provided field exceeds the 4,000-char cap", async () => {
    const response = await PATCH(makeRequest({ greeting: "x".repeat(4001) }));
    expect(response.status).toBe(400);
    expect(updateLetterTemplate).not.toHaveBeenCalled();
  });

  it("ignores an unrecognized key alongside a valid field, writing only the valid field", async () => {
    vi.mocked(updateLetterTemplate).mockResolvedValueOnce({} as never);

    await PATCH(makeRequest({ greeting: "Dear {{donorName}},", maliciousField: "nope" }));

    expect(updateLetterTemplate).toHaveBeenCalledWith(
      { greeting: "Dear {{donorName}}," },
      "user-1",
    );
  });
});
