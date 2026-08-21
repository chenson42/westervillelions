/**
 * Unit tests for GET/PATCH /api/admin/welcome-packets/[id].
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "Unit tests to write" -> "API route tests", case 11 (401/403 on every
 * route).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/welcome-packets-queries directly (not the raw DB) — same convention
 * as src/app/api/admin/minutes/[id]/route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/welcome-packets-queries", () => ({
  getWelcomePacketById: vi.fn(),
  updateWelcomePacket: vi.fn(),
}));

import { GET, PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getWelcomePacketById, updateWelcomePacket } from "@/lib/welcome-packets-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_PACKET = {
  id: "packet-1",
  lionsYear: "2026-27",
  rawHtml: '<title>X</title><style>body{}</style><div class="deck">...</div>',
  createdByUserId: null,
  updatedByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  isCurrent: false,
};

const VALID_BODY = { lionsYear: "2027-28", rawHtml: EXISTING_PACKET.rawHtml };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getWelcomePacketById).mockReset();
  vi.mocked(updateWelcomePacket).mockReset();
});

describe("GET /api/admin/welcome-packets/[id]", () => {
  it("case 11: returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await GET(makeRequest(undefined) as never, makeParams("packet-1"));

    expect(response.status).toBe(401);
    expect(getWelcomePacketById).not.toHaveBeenCalled();
  });

  it("case 11: returns 403 when the session lacks welcome_packet.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await GET(makeRequest(undefined) as never, makeParams("packet-1"));

    expect(response.status).toBe(403);
    expect(getWelcomePacketById).not.toHaveBeenCalled();
  });

  it("returns 404 when the id doesn't resolve to an existing packet", async () => {
    vi.mocked(getWelcomePacketById).mockResolvedValue(null);

    const response = await GET(makeRequest(undefined) as never, makeParams("does-not-exist"));

    expect(response.status).toBe(404);
  });

  it("returns 200 { packet } for an existing id", async () => {
    vi.mocked(getWelcomePacketById).mockResolvedValue(EXISTING_PACKET);

    const response = await GET(makeRequest(undefined) as never, makeParams("packet-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.packet.id).toBe("packet-1");
    expect(body.packet.rawHtml).toBe(EXISTING_PACKET.rawHtml);
  });
});

describe("PATCH /api/admin/welcome-packets/[id]", () => {
  it("case 11: returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await PATCH(makeRequest(VALID_BODY), makeParams("packet-1"));

    expect(response.status).toBe(401);
    expect(updateWelcomePacket).not.toHaveBeenCalled();
  });

  it("case 11: returns 403 when the session lacks welcome_packet.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await PATCH(makeRequest(VALID_BODY), makeParams("packet-1"));

    expect(response.status).toBe(403);
    expect(updateWelcomePacket).not.toHaveBeenCalled();
  });

  it("returns 404 when the id doesn't resolve to an existing packet", async () => {
    vi.mocked(getWelcomePacketById).mockResolvedValue(null);

    const response = await PATCH(makeRequest(VALID_BODY), makeParams("does-not-exist"));

    expect(response.status).toBe(404);
    expect(updateWelcomePacket).not.toHaveBeenCalled();
  });

  it("returns 400 with the query module's message on a validation failure", async () => {
    vi.mocked(getWelcomePacketById).mockResolvedValue(EXISTING_PACKET);
    vi.mocked(updateWelcomePacket).mockResolvedValue({
      ok: false,
      reason: "parse_error",
      message: "Couldn't save: missing expected anchor(s): <style>.",
    });

    const response = await PATCH(makeRequest(VALID_BODY), makeParams("packet-1"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("missing expected anchor(s)");
  });

  it("returns 200 { ok: true } on success", async () => {
    vi.mocked(getWelcomePacketById).mockResolvedValue(EXISTING_PACKET);
    vi.mocked(updateWelcomePacket).mockResolvedValue({ ok: true, id: "packet-1" });

    const response = await PATCH(makeRequest(VALID_BODY), makeParams("packet-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updateWelcomePacket).toHaveBeenCalledWith(
      "packet-1",
      expect.objectContaining({ lionsYear: "2027-28", updatedByUserId: "user-1" }),
    );
  });
});
