/**
 * Unit tests for PUT /api/admin/club-files/[id]/attachments.
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Unit Tests
 * Required": full-set replace semantics; duplicate eventId deduped, not a
 * unique-constraint error. The substantive dedupe/diff logic is tested at
 * the queries layer (src/lib/club-files-queries.test.ts); this file covers
 * gating and HTTP-status mapping, matching
 * src/app/api/admin/welcome-packets/[id]/mark-current/route.test.ts's
 * convention of mocking the queries module directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/club-files-queries", () => ({ setClubFileEventAttachments: vi.fn() }));

import { PUT } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { setClubFileEventAttachments } from "@/lib/club-files-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id = "file-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(setClubFileEventAttachments).mockReset();
});

describe("PUT /api/admin/club-files/[id]/attachments", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await PUT(makeRequest({ eventIds: [] }), makeParams());

    expect(res.status).toBe(401);
    expect(setClubFileEventAttachments).not.toHaveBeenCalled();
  });

  it("returns 403 when the session lacks club_files.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const res = await PUT(makeRequest({ eventIds: [] }), makeParams());

    expect(res.status).toBe(403);
    expect(setClubFileEventAttachments).not.toHaveBeenCalled();
  });

  it("returns 400 when eventIds is missing", async () => {
    const res = await PUT(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
    expect(setClubFileEventAttachments).not.toHaveBeenCalled();
  });

  it("returns 400 when eventIds contains a non-string", async () => {
    const res = await PUT(makeRequest({ eventIds: ["event-1", 5] }), makeParams());
    expect(res.status).toBe(400);
    expect(setClubFileEventAttachments).not.toHaveBeenCalled();
  });

  it("returns 404 when the file doesn't exist", async () => {
    vi.mocked(setClubFileEventAttachments).mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await PUT(makeRequest({ eventIds: ["event-1"] }), makeParams("ghost"));

    expect(res.status).toBe(404);
  });

  it("passes a duplicate eventId straight through to the queries layer, which owns dedupe", async () => {
    vi.mocked(setClubFileEventAttachments).mockResolvedValue({
      ok: true,
      eventIds: ["event-1", "event-2"],
    });

    const res = await PUT(
      makeRequest({ eventIds: ["event-1", "event-1", "event-2"] }),
      makeParams("file-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.eventIds).toEqual(["event-1", "event-2"]);
    expect(setClubFileEventAttachments).toHaveBeenCalledWith("file-1", [
      "event-1",
      "event-1",
      "event-2",
    ]);
  });
});
