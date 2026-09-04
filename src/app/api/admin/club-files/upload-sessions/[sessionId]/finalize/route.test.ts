/**
 * Unit tests for POST /api/admin/club-files/upload-sessions/[sessionId]/finalize.
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Unit Tests
 * Required": chunk-assembly checksum mismatch rejected (400, session left
 * alive); size mismatch rejected; magic-byte rejection; missing/gapped
 * chunk rejected; happy-path create; happy-path replace atomicity. The
 * substantive assembly/validation/atomicity logic is tested at the queries
 * layer (src/lib/club-file-upload-queries.test.ts, which directly asserts
 * "session left alive" via the mocked db calls); this file covers gating,
 * request-body validation, and HTTP-status mapping for every discriminated
 * failure reason the queries layer can return.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/club-file-upload-queries", () => ({ finalizeUploadSession: vi.fn() }));
// The route imports isValidClubFileVisibility from club-files-queries.ts,
// which itself imports @/lib/db (a real DB connection requiring
// DATABASE_URL) — mock the whole module with a literal re-implementation of
// the validator (not importOriginal, which would still execute the real
// module's @/lib/db import) so this test stays hermetic.
vi.mock("@/lib/club-files-queries", () => ({
  isValidClubFileVisibility: (v: unknown) => v === "public" || v === "members-only",
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { finalizeUploadSession } from "@/lib/club-file-upload-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(sessionId = "sess-1") {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(finalizeUploadSession).mockReset();
});

describe("POST .../upload-sessions/[sessionId]/finalize", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await POST(makeRequest({}), makeParams());

    expect(res.status).toBe(401);
    expect(finalizeUploadSession).not.toHaveBeenCalled();
  });

  it("returns 403 when the session lacks club_files.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const res = await POST(makeRequest({}), makeParams());

    expect(res.status).toBe(403);
    expect(finalizeUploadSession).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid visibility value before ever calling the queries layer", async () => {
    const res = await POST(
      makeRequest({ name: "Packet", visibility: "everyone" }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    expect(finalizeUploadSession).not.toHaveBeenCalled();
  });

  it("returns 404 when the session doesn't exist", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({ ok: false, reason: "session_not_found" });

    const res = await POST(makeRequest({}), makeParams());

    expect(res.status).toBe(404);
  });

  it("returns 400 naming the missing chunk index", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({
      ok: false,
      reason: "missing_chunk",
      missingIndex: 2,
    });

    const res = await POST(makeRequest({ name: "Packet", visibility: "public" }), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/missing chunk 2/);
  });

  it("returns 400 for a size mismatch", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({
      ok: false,
      reason: "size_mismatch",
      expected: 100,
      actual: 90,
    });

    const res = await POST(makeRequest({ name: "Packet", visibility: "public" }), makeParams());

    expect(res.status).toBe(400);
  });

  it("returns 400 for a checksum mismatch", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({ ok: false, reason: "checksum_mismatch" });

    const res = await POST(
      makeRequest({ name: "Packet", visibility: "public", checksumSha256: "deadbeef" }),
      makeParams(),
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for magic-byte rejection (not a valid PDF)", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({ ok: false, reason: "invalid_type" });

    const res = await POST(makeRequest({ name: "Packet", visibility: "public" }), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/valid PDF/);
  });

  it("returns 400 when required metadata is missing for a new file", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({ ok: false, reason: "missing_metadata" });

    const res = await POST(makeRequest({}), makeParams());

    expect(res.status).toBe(400);
  });

  it("happy path create: returns 200 with { id, replaced: false }", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({ ok: true, fileId: "file-1", replaced: false });

    const res = await POST(makeRequest({ name: "Packet", visibility: "public" }), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "file-1", replaced: false });
  });

  it("happy path replace: returns 200 with { id, replaced: true } and no metadata required", async () => {
    vi.mocked(finalizeUploadSession).mockResolvedValue({ ok: true, fileId: "file-1", replaced: true });

    const res = await POST(makeRequest({}), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "file-1", replaced: true });
  });
});
