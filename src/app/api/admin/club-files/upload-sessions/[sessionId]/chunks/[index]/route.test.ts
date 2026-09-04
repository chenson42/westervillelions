/**
 * Unit tests for PUT /api/admin/club-files/upload-sessions/[sessionId]/chunks/[index].
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Unit Tests
 * Required": non-final chunk with wrong byte length rejected; out-of-range
 * index rejected; re-PUTting the same index twice succeeds (idempotent
 * retry). The substantive length/index/upsert logic is tested at the
 * queries layer (src/lib/club-file-upload-queries.test.ts); this file
 * covers gating, raw-body handling, and HTTP-status mapping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/club-file-upload-queries", () => ({ putUploadChunk: vi.fn() }));

import { PUT } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { putUploadChunk } from "@/lib/club-file-upload-queries";

function makeRequest(bytes: Buffer): NextRequest {
  return {
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as NextRequest;
}

function makeParams(sessionId = "sess-1", index = "0") {
  return { params: Promise.resolve({ sessionId, index }) };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(putUploadChunk).mockReset();
});

describe("PUT .../upload-sessions/[sessionId]/chunks/[index]", () => {
  it("returns 401 when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    const res = await PUT(makeRequest(Buffer.alloc(10)), makeParams());

    expect(res.status).toBe(401);
    expect(putUploadChunk).not.toHaveBeenCalled();
  });

  it("returns 403 when the session lacks club_files.manage", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const res = await PUT(makeRequest(Buffer.alloc(10)), makeParams());

    expect(res.status).toBe(403);
    expect(putUploadChunk).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric index without calling the queries layer", async () => {
    const res = await PUT(makeRequest(Buffer.alloc(10)), makeParams("sess-1", "not-a-number"));

    expect(res.status).toBe(400);
    expect(putUploadChunk).not.toHaveBeenCalled();
  });

  it("returns 404 when the session doesn't exist", async () => {
    vi.mocked(putUploadChunk).mockResolvedValue({ ok: false, reason: "session_not_found" });

    const res = await PUT(makeRequest(Buffer.alloc(10)), makeParams());

    expect(res.status).toBe(404);
  });

  it("returns 400 for an out-of-range chunk index", async () => {
    vi.mocked(putUploadChunk).mockResolvedValue({ ok: false, reason: "index_out_of_range" });

    const res = await PUT(makeRequest(Buffer.alloc(10)), makeParams("sess-1", "99"));

    expect(res.status).toBe(400);
  });

  it("returns 400 when a non-final chunk's byte length is wrong", async () => {
    vi.mocked(putUploadChunk).mockResolvedValue({ ok: false, reason: "wrong_length" });

    const res = await PUT(makeRequest(Buffer.alloc(5)), makeParams());

    expect(res.status).toBe(400);
  });

  it("passes the raw request body bytes through unchanged to putUploadChunk", async () => {
    vi.mocked(putUploadChunk).mockResolvedValue({
      ok: true,
      chunkIndex: 0,
      receivedChunks: 1,
      totalChunks: 2,
    });

    const bytes = Buffer.from("hello-chunk");
    await PUT(makeRequest(bytes), makeParams("sess-1", "0"));

    expect(putUploadChunk).toHaveBeenCalledTimes(1);
    const [sessionIdArg, indexArg, bytesArg] = vi.mocked(putUploadChunk).mock.calls[0];
    expect(sessionIdArg).toBe("sess-1");
    expect(indexArg).toBe(0);
    expect(Buffer.from(bytesArg as Buffer).toString()).toBe("hello-chunk");
  });

  it("re-PUTting the same index twice both succeed (idempotent retry) — route imposes no extra restriction", async () => {
    vi.mocked(putUploadChunk).mockResolvedValue({
      ok: true,
      chunkIndex: 0,
      receivedChunks: 1,
      totalChunks: 1,
    });

    const first = await PUT(makeRequest(Buffer.from("v1")), makeParams("sess-1", "0"));
    const second = await PUT(makeRequest(Buffer.from("v2")), makeParams("sess-1", "0"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(putUploadChunk).toHaveBeenCalledTimes(2);
  });

  it("returns receivedChunks/totalChunks in the success response", async () => {
    vi.mocked(putUploadChunk).mockResolvedValue({
      ok: true,
      chunkIndex: 1,
      receivedChunks: 2,
      totalChunks: 3,
    });

    const res = await PUT(makeRequest(Buffer.alloc(10)), makeParams("sess-1", "1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ chunkIndex: 1, receivedChunks: 2, totalChunks: 3 });
  });
});
