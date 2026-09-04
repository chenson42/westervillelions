/**
 * Unit tests for POST /api/admin/club-files/upload-sessions (init).
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Unit Tests
 * Required": declaredSize over 25MB rejected; stale-session sweep runs on
 * init. The sweep and cap logic themselves are tested at the queries layer
 * (src/lib/club-file-upload-queries.test.ts); this file covers gating,
 * request validation, and HTTP-status mapping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/club-file-upload-queries", () => ({
  createUploadSession: vi.fn(),
  CLUB_FILE_MAX_DECLARED_SIZE: 25 * 1024 * 1024,
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { createUploadSession } from "@/lib/club-file-upload-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(createUploadSession).mockReset();
});

describe("POST /api/admin/club-files/upload-sessions", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await POST(makeRequest({ filename: "a.pdf", declaredSize: 100 }));

    expect(res.status).toBe(401);
    expect(createUploadSession).not.toHaveBeenCalled();
  });

  it("returns 403 when the session lacks club_files.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const res = await POST(makeRequest({ filename: "a.pdf", declaredSize: 100 }));

    expect(res.status).toBe(403);
    expect(createUploadSession).not.toHaveBeenCalled();
  });

  it("returns 400 when filename is missing", async () => {
    const res = await POST(makeRequest({ declaredSize: 100 }));
    expect(res.status).toBe(400);
    expect(createUploadSession).not.toHaveBeenCalled();
  });

  it("returns 400 when declaredSize is not a positive integer", async () => {
    const res = await POST(makeRequest({ filename: "a.pdf", declaredSize: -5 }));
    expect(res.status).toBe(400);
    expect(createUploadSession).not.toHaveBeenCalled();
  });

  it("returns 400 with a size-cap message when declaredSize exceeds the 25MB cap", async () => {
    vi.mocked(createUploadSession).mockResolvedValue({ ok: false, reason: "too_large" });

    const res = await POST(
      makeRequest({ filename: "big.pdf", declaredSize: 26_214_401 }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/25 MB/);
  });

  it("returns 404 when replaceFileId doesn't resolve to an existing file", async () => {
    vi.mocked(createUploadSession).mockResolvedValue({
      ok: false,
      reason: "replace_target_not_found",
    });

    const res = await POST(
      makeRequest({ filename: "a.pdf", declaredSize: 100, replaceFileId: "ghost" }),
    );

    expect(res.status).toBe(404);
  });

  it("returns the session plan on success", async () => {
    vi.mocked(createUploadSession).mockResolvedValue({
      ok: true,
      sessionId: "sess-1",
      chunkSize: 3145728,
      totalChunks: 1,
    });

    const res = await POST(makeRequest({ filename: "a.pdf", declaredSize: 100 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sessionId: "sess-1", chunkSize: 3145728, totalChunks: 1 });
    expect(createUploadSession).toHaveBeenCalledWith({
      filename: "a.pdf",
      declaredSize: 100,
      replaceFileId: null,
      createdByUserId: "user-1",
    });
  });
});
