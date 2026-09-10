/**
 * Unit tests for src/lib/hooks/use-chunked-upload.ts.
 *
 * Targets `runChunks` / `runFinalize` / `resumeUpload` directly rather than
 * rendering the `useChunkedUpload` hook: this repo has no jsdom or
 * @testing-library/react set up for hook testing (vitest.config.ts runs
 * with `environment: "node"`), and these three functions are deliberately
 * framework-free (no React hooks/refs) so the resume-point bookkeeping can
 * be exercised with a mocked global `fetch` alone.
 *
 * Regression coverage for a real bug: an earlier version of this file only
 * recorded where to resume on a chunk *failure*, never on chunk success.
 * A run where every chunk landed but the following finalize() call failed
 * left the resume point at 0, so retry() re-uploaded the entire file
 * instead of re-sending only finalize — silently contradicting this file's
 * own protocol doc comment. Both tests below fail against that behavior
 * and pass against the fix (verified by running them against the
 * pre-fix file via `git stash`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runChunks,
  runFinalize,
  resumeUpload,
  type UploadSession,
} from "@/lib/hooks/use-chunked-upload";

function chunkUrl(sessionId: string, index: number) {
  return `/api/admin/club-files/upload-sessions/${sessionId}/chunks/${index}`;
}

function finalizeUrl(sessionId: string) {
  return `/api/admin/club-files/upload-sessions/${sessionId}/finalize`;
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response;
}

function makeFile(size: number) {
  return new File([new Uint8Array(size)], "packet.pdf", { type: "application/pdf" });
}

function baseSession(overrides: Partial<UploadSession> = {}): UploadSession {
  return {
    file: makeFile(9),
    metadata: { name: "Packet", visibility: "members-only" },
    sessionId: "sess-1",
    chunkSize: 3,
    totalChunks: 3,
    nextChunkIndex: 0,
    ...overrides,
  };
}

describe("runChunks", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("reports nextChunkIndex === totalChunks when every chunk succeeds", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const match = url.match(/chunks\/(\d+)$/);
      const index = Number(match![1]);
      return jsonResponse({ chunkIndex: index, receivedChunks: index + 1, totalChunks: 3 });
    });

    const onProgress = vi.fn();
    const result = await runChunks({
      file: makeFile(9),
      sessionId: "sess-1",
      chunkSize: 3,
      totalChunks: 3,
      startIndex: 0,
      onProgress,
    });

    expect(result.error).toBeUndefined();
    expect(result.nextChunkIndex).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it("stops at the first chunk that exhausts its retries and reports that index (not a later one)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const index = Number(url.match(/chunks\/(\d+)$/)![1]);
      if (index === 2) return jsonResponse({ error: "boom" }, false);
      return jsonResponse({ chunkIndex: index, receivedChunks: index + 1, totalChunks: 4 });
    });

    const result = await runChunks({
      file: makeFile(12),
      sessionId: "sess-1",
      chunkSize: 3,
      totalChunks: 4,
      startIndex: 0,
      onProgress: vi.fn(),
    });

    expect(result.nextChunkIndex).toBe(2);
    expect(result.error).toBeInstanceOf(Error);

    // Chunks 0 and 1: one call each. Chunk 2: retried up to the limit (3).
    // Chunk 3 is never attempted because the loop stops at the failure.
    const urlsCalled = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urlsCalled.filter((u) => u === chunkUrl("sess-1", 0))).toHaveLength(1);
    expect(urlsCalled.filter((u) => u === chunkUrl("sess-1", 1))).toHaveLength(1);
    expect(urlsCalled.filter((u) => u === chunkUrl("sess-1", 2))).toHaveLength(3);
    expect(urlsCalled.filter((u) => u === chunkUrl("sess-1", 3))).toHaveLength(0);
  });
});

describe("resumeUpload — retry semantics", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("all chunks succeed, finalize fails: retry re-sends ONLY finalize, never re-uploads chunks", async () => {
    const session = baseSession();

    // Round 1: every chunk PUT succeeds, finalize fails once.
    fetchMock.mockImplementation(async (url: string) => {
      if (url === finalizeUrl("sess-1")) return jsonResponse({ error: "db hiccup" }, false);
      const index = Number(url.match(/chunks\/(\d+)$/)![1]);
      return jsonResponse({ chunkIndex: index, receivedChunks: index + 1, totalChunks: 3 });
    });

    const first = await resumeUpload(session, { onProgress: vi.fn() });

    expect(first.result).toBeUndefined();
    expect(first.error).toBeInstanceOf(Error);
    // This is the crux of the bug: the resumed session's nextChunkIndex
    // must equal totalChunks (every chunk landed), not stay at 0.
    expect(first.session?.nextChunkIndex).toBe(3);

    const chunkCallsRound1 = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes("/chunks/"),
    );
    expect(chunkCallsRound1).toHaveLength(3);

    // Round 2 ("retry"): finalize now succeeds.
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === finalizeUrl("sess-1")) {
        return jsonResponse({ id: "file-123", replaced: false });
      }
      throw new Error(`unexpected fetch in retry round: ${url}`);
    });

    const retryResult = await resumeUpload(first.session!, { onProgress: vi.fn() });

    expect(retryResult.error).toBeUndefined();
    expect(retryResult.result).toEqual({ id: "file-123", replaced: false });
    // No chunk endpoint touched on retry — only finalize.
    const chunkCallsRound2 = fetchMock.mock.calls.filter((c) =>
      (c[0] as string).includes("/chunks/"),
    );
    expect(chunkCallsRound2).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(finalizeUrl("sess-1"), expect.anything());
  });

  it("a mid-sequence chunk failure resumes from the correct index and does not re-send already-accepted chunks", async () => {
    const session = baseSession({
      file: makeFile(12),
      chunkSize: 3,
      totalChunks: 4,
    });

    // Round 1: chunks 0 and 1 succeed, chunk 2 fails every attempt.
    fetchMock.mockImplementation(async (url: string) => {
      const index = Number(url.match(/chunks\/(\d+)$/)![1]);
      if (index === 2) return jsonResponse({ error: "network blip" }, false);
      return jsonResponse({ chunkIndex: index, receivedChunks: index + 1, totalChunks: 4 });
    });

    const first = await resumeUpload(session, { onProgress: vi.fn() });

    expect(first.result).toBeUndefined();
    expect(first.session?.nextChunkIndex).toBe(2);

    // Round 2 ("retry"): only chunks 2 and 3, then finalize, should fire.
    fetchMock.mockReset();
    const calledUrls: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      calledUrls.push(url);
      if (url === finalizeUrl("sess-1")) return jsonResponse({ id: "file-9", replaced: false });
      const index = Number(url.match(/chunks\/(\d+)$/)![1]);
      return jsonResponse({ chunkIndex: index, receivedChunks: index + 1, totalChunks: 4 });
    });

    const retryResult = await resumeUpload(first.session!, { onProgress: vi.fn() });

    expect(retryResult.result).toEqual({ id: "file-9", replaced: false });
    expect(calledUrls).not.toContain(chunkUrl("sess-1", 0));
    expect(calledUrls).not.toContain(chunkUrl("sess-1", 1));
    expect(calledUrls).toContain(chunkUrl("sess-1", 2));
    expect(calledUrls).toContain(chunkUrl("sess-1", 3));
    expect(calledUrls).toContain(finalizeUrl("sess-1"));
  });

  it("calls onFinalizing right before the finalize request, so UI can flip status even on a chunk-skipping retry", async () => {
    const session = baseSession({ nextChunkIndex: 3 }); // all chunks already landed
    fetchMock.mockImplementation(async () => jsonResponse({ id: "file-1", replaced: true }));

    const events: string[] = [];
    await resumeUpload(session, {
      onProgress: vi.fn(),
      onFinalizing: () => events.push("finalizing"),
    });

    expect(events).toEqual(["finalizing"]);
    // Skipped chunks entirely — resuming at finalize only.
    const chunkCalls = fetchMock.mock.calls.filter((c) => (c[0] as string).includes("/chunks/"));
    expect(chunkCalls).toHaveLength(0);
  });
});

describe("runFinalize", () => {
  it("throws the server's error message on failure, falls back otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, false)),
    );
    await expect(runFinalize("sess-1", {})).rejects.toThrow("Could not finish the upload.");
  });

  it("returns the parsed id/replaced on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ id: "abc", replaced: true })),
    );
    await expect(runFinalize("sess-1", {})).resolves.toEqual({ id: "abc", replaced: true });
  });
});
