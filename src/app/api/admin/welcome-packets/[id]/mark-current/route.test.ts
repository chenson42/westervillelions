/**
 * Unit tests for POST /api/admin/welcome-packets/[id]/mark-current.
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "Unit tests to write" -> "API route tests", cases 11 (401/403) and 13
 * (an id that doesn't exist returns 404).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/welcome-packets-queries directly (not the raw DB) — same convention
 * as src/app/api/admin/minutes/[id]/restore/route.ts's sibling tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/welcome-packets-queries", () => ({ markWelcomePacketCurrent: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { markWelcomePacketCurrent } from "@/lib/welcome-packets-queries";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(markWelcomePacketCurrent).mockReset();
});

describe("POST /api/admin/welcome-packets/[id]/mark-current", () => {
  it("case 11: returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const response = await POST({} as NextRequest, makeParams("packet-1"));

    expect(response.status).toBe(401);
    expect(markWelcomePacketCurrent).not.toHaveBeenCalled();
  });

  it("case 11: returns 403 when the session lacks welcome_packet.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const response = await POST({} as NextRequest, makeParams("packet-1"));

    expect(response.status).toBe(403);
    expect(markWelcomePacketCurrent).not.toHaveBeenCalled();
  });

  it("case 13: an id that doesn't exist returns 404", async () => {
    vi.mocked(markWelcomePacketCurrent).mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await POST({} as NextRequest, makeParams("does-not-exist"));

    expect(response.status).toBe(404);
  });

  it("returns 200 { ok: true } on success, attributing the publish to the session user", async () => {
    vi.mocked(markWelcomePacketCurrent).mockResolvedValue({ ok: true });

    const response = await POST({} as NextRequest, makeParams("packet-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(markWelcomePacketCurrent).toHaveBeenCalledWith("packet-1", "user-1");
  });
});
