/**
 * Unit tests for GET/POST /api/admin/welcome-packets.
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "Unit tests to write" -> "API route tests", cases 11 (401/403 on every
 * route) and 12 (a parse_error-triggering POST body returns 400 with the
 * specific missing-anchor message).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/welcome-packets-queries directly (not the raw DB) — same convention
 * as src/app/api/admin/minutes/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/welcome-packets-queries", () => ({
  createWelcomePacket: vi.fn(),
  listWelcomePackets: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { createWelcomePacket, listWelcomePackets } from "@/lib/welcome-packets-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = {
  lionsYear: "2027-28",
  rawHtml: '<title>X</title><style>body{}</style><div class="deck">...</div>',
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(createWelcomePacket).mockReset();
  vi.mocked(listWelcomePackets).mockReset();
});

describe("GET /api/admin/welcome-packets", () => {
  it("case 11: returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(listWelcomePackets).not.toHaveBeenCalled();
  });

  it("case 11: returns 403 when the session lacks welcome_packet.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(listWelcomePackets).not.toHaveBeenCalled();
  });

  it("returns the packet list with a 200 for a properly gated session", async () => {
    vi.mocked(listWelcomePackets).mockResolvedValue([
      {
        id: "packet-1",
        lionsYear: "2026-27",
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isCurrent: true,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.packets).toHaveLength(1);
  });
});

describe("POST /api/admin/welcome-packets", () => {
  it("case 11: returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(createWelcomePacket).not.toHaveBeenCalled();
  });

  it("case 11: returns 403 when the session lacks welcome_packet.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(403);
    expect(createWelcomePacket).not.toHaveBeenCalled();
  });

  it("returns 400 when lionsYear is missing", async () => {
    const response = await POST(makeRequest({ rawHtml: VALID_BODY.rawHtml }));

    expect(response.status).toBe(400);
    expect(createWelcomePacket).not.toHaveBeenCalled();
  });

  it("returns 400 when rawHtml is missing", async () => {
    const response = await POST(makeRequest({ lionsYear: "2027-28" }));

    expect(response.status).toBe(400);
    expect(createWelcomePacket).not.toHaveBeenCalled();
  });

  it("case 12: a parse_error-triggering body returns 400 with the specific missing-anchor message, not a generic error", async () => {
    vi.mocked(createWelcomePacket).mockResolvedValue({
      ok: false,
      reason: "parse_error",
      message: 'Couldn\'t save: missing expected anchor(s): <style>, <div class="deck">.',
    });

    const response = await POST(makeRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("missing expected anchor(s)");
    expect(body.error).toContain('<div class="deck">');
  });

  it("returns 201 { id } on success", async () => {
    vi.mocked(createWelcomePacket).mockResolvedValue({ ok: true, id: "packet-1" });

    const response = await POST(makeRequest(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe("packet-1");
    expect(createWelcomePacket).toHaveBeenCalledWith(
      expect.objectContaining({ lionsYear: "2027-28", createdByUserId: "user-1" }),
    );
  });
});
