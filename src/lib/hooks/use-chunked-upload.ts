"use client";

/**
 * Club Files chunked-upload client protocol (DECISION-095).
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Upload Transport" +
 * Phase 4b's "Chunk-upload client protocol" handoff note. Shared by the
 * new-file upload form and the replace-file control — this is the one place
 * the init -> chunk-PUT-loop -> finalize sequence is allowed to live.
 *
 * Protocol:
 *   1. POST /api/admin/club-files/upload-sessions
 *        { filename, declaredSize, replaceFileId? }
 *      -> { sessionId, chunkSize, totalChunks }
 *   2. PUT  /api/admin/club-files/upload-sessions/[sessionId]/chunks/[index]
 *        raw binary body (a Blob slice — never FormData/base64, which would
 *        inflate a 3MB chunk past Vercel's 4.5MB request-body cap)
 *      -> { chunkIndex, receivedChunks, totalChunks }
 *      Idempotent: a failed chunk PUT can always be retried with the
 *      identical slice.
 *   3. POST /api/admin/club-files/upload-sessions/[sessionId]/finalize
 *        { name?, description?, visibility? } — required for a new file,
 *        ignored for a replace
 *      -> { id, replaced }
 *      A 400 here leaves the session alive server-side — retry() re-sends
 *      only the finalize step, never re-uploads the chunks. That guarantee
 *      depends entirely on `nextChunkIndex` (see UploadSession below)
 *      having advanced past every chunk that already landed — see the
 *      `runChunks` doc comment for the bug this project once had here.
 *
 * `runChunks` / `runFinalize` / `resumeUpload` below are deliberately plain
 * async functions with no React hooks or refs — they take their inputs as
 * plain arguments and report progress via a callback instead of closing
 * over `useState` setters. That's what makes them unit-testable with a
 * mocked `fetch` and no DOM/React-renderer (this repo has neither jsdom nor
 * @testing-library/react set up for hook testing — see
 * use-chunked-upload.test.ts). `useChunkedUpload` itself is a thin
 * React-state wrapper around `resumeUpload`.
 */

import { useCallback, useRef, useState } from "react";

export type ClubFileVisibility = "public" | "members-only";

export interface ChunkedUploadMetadata {
  name?: string;
  description?: string | null;
  visibility?: ClubFileVisibility;
}

export interface ChunkedUploadOptions {
  /** Set when this upload replaces an existing file's bytes in place. */
  replaceFileId?: string;
}

export interface ChunkedUploadResult {
  id: string;
  replaced: boolean;
}

export type ChunkedUploadStatus = "idle" | "uploading" | "finalizing" | "error" | "done";

// Mirrors CLUB_FILE_MAX_DECLARED_SIZE in src/lib/club-file-upload-queries.ts.
// Duplicated here (not imported) because that module pulls in @/lib/db,
// which must never reach a client bundle — this is a client-side early
// check only; the server route is the authoritative enforcement.
export const CLUB_FILE_MAX_DECLARED_SIZE = 26_214_400; // 25 MB

const CHUNK_RETRY_LIMIT = 3;

async function readJsonOrThrow(res: Response, fallback: string) {
  if (res.ok) return res.json();
  const data = await res.json().catch(() => ({}));
  throw new Error((data as { error?: string }).error || fallback);
}

export interface UploadSession {
  file: File;
  metadata: ChunkedUploadMetadata;
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  /**
   * The chunk to send next. Equal to `totalChunks` once every chunk has
   * landed server-side — that, and only that, is what tells `resumeUpload`
   * to skip the chunk loop entirely and go straight to finalize().
   */
  nextChunkIndex: number;
}

export interface RunChunksArgs {
  file: File;
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  startIndex: number;
  onProgress: (percent: number) => void;
}

export interface RunChunksResult {
  /**
   * Chunk index to resume from on a later retry. Equals `totalChunks` when
   * every chunk in [startIndex, totalChunks) landed successfully.
   */
  nextChunkIndex: number;
  /** Set when the loop stopped early because a chunk exhausted its retries. */
  error?: Error;
}

/**
 * Uploads chunks [startIndex, totalChunks) of `file`, retrying each chunk
 * up to CHUNK_RETRY_LIMIT times before giving up.
 *
 * Bug history: an earlier version of this file only recorded a resume
 * point on failure, never on success. That meant a run where every chunk
 * succeeded but the *following* finalize() call failed left the resume
 * point at wherever it started (0, for a fresh upload) — so retry() would
 * re-upload the entire file instead of re-sending only finalize, directly
 * contradicting the protocol doc comment above. The fix is that this
 * function always reports where it actually got to: `totalChunks` on full
 * success, or the first never-landed chunk on failure. Never assume a
 * caller's starting resume point without re-deriving it from this result.
 */
export async function runChunks(args: RunChunksArgs): Promise<RunChunksResult> {
  const { file, sessionId, chunkSize, totalChunks, startIndex, onProgress } = args;

  for (let index = startIndex; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const slice = file.slice(start, end);

    let lastError: unknown = null;
    let ok = false;
    for (let attempt = 1; attempt <= CHUNK_RETRY_LIMIT && !ok; attempt++) {
      try {
        const res = await fetch(
          `/api/admin/club-files/upload-sessions/${sessionId}/chunks/${index}`,
          { method: "PUT", body: slice },
        );
        const data = await readJsonOrThrow(
          res,
          `Chunk ${index + 1} of ${totalChunks} failed to upload.`,
        );
        onProgress(Math.round((data.receivedChunks / data.totalChunks) * 100));
        ok = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (!ok) {
      return {
        nextChunkIndex: index,
        error: lastError instanceof Error ? lastError : new Error("Chunk upload failed."),
      };
    }
  }

  return { nextChunkIndex: totalChunks };
}

export async function runFinalize(
  sessionId: string,
  metadata: ChunkedUploadMetadata,
): Promise<ChunkedUploadResult> {
  const res = await fetch(`/api/admin/club-files/upload-sessions/${sessionId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const data = await readJsonOrThrow(res, "Could not finish the upload.");
  return { id: data.id as string, replaced: Boolean(data.replaced) };
}

export interface ResumeUploadCallbacks {
  onProgress: (percent: number) => void;
  /** Fired right before the finalize call — lets the caller flip UI status. */
  onFinalizing?: () => void;
}

export interface ResumeUploadOutcome {
  result?: ChunkedUploadResult;
  /**
   * Present whenever the run did not finish. Carries the session with
   * `nextChunkIndex` updated to reflect exactly what landed, so a
   * subsequent `resumeUpload` call resumes correctly — re-sending only the
   * chunks (if any) that never made it, then finalize.
   */
  session?: UploadSession;
  error?: Error;
}

/**
 * Runs whatever remains of the upload from `session.nextChunkIndex`:
 * chunks first (skipped entirely if they already all landed), then
 * finalize. This is the single place that decides whether a retry
 * re-uploads chunks — used identically for a fresh upload (nextChunkIndex:
 * 0) and for retry() after a prior failure, so there is exactly one
 * implementation of "where do we resume" to get right.
 */
export async function resumeUpload(
  session: UploadSession,
  callbacks: ResumeUploadCallbacks,
): Promise<ResumeUploadOutcome> {
  let current = session;

  if (current.nextChunkIndex < current.totalChunks) {
    const chunksResult = await runChunks({
      file: current.file,
      sessionId: current.sessionId,
      chunkSize: current.chunkSize,
      totalChunks: current.totalChunks,
      startIndex: current.nextChunkIndex,
      onProgress: callbacks.onProgress,
    });
    current = { ...current, nextChunkIndex: chunksResult.nextChunkIndex };
    if (chunksResult.error) {
      return { session: current, error: chunksResult.error };
    }
  }

  callbacks.onFinalizing?.();
  try {
    const result = await runFinalize(current.sessionId, current.metadata);
    return { result };
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Could not finish the upload.");
    return { session: current, error };
  }
}

export function useChunkedUpload() {
  const [status, setStatus] = useState<ChunkedUploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Mirrors `resumeRef.current !== null`, updated at every point that ref is
  // written (see below). Tracked as state — rather than read directly off
  // the ref in the returned object — because reading a ref during render is
  // disallowed (react-hooks/refs): render output must be reproducible from
  // props/state alone, and a ref mutation doesn't itself schedule a
  // re-render, so a render-time read can silently miss the update it's
  // supposed to reflect.
  const [canRetry, setCanRetry] = useState(false);
  const resumeRef = useRef<UploadSession | null>(null);

  const runSession = useCallback(
    async (session: UploadSession): Promise<ChunkedUploadResult | null> => {
      setStatus(session.nextChunkIndex >= session.totalChunks ? "finalizing" : "uploading");
      // Clear any error left over from a prior failed attempt immediately,
      // not just on eventual success — matches upload()'s own setError(null)
      // and keeps a stale message from lingering onscreen during a retry.
      setError(null);

      const outcome = await resumeUpload(session, {
        onProgress: setProgress,
        onFinalizing: () => setStatus("finalizing"),
      });

      if (outcome.result) {
        resumeRef.current = null;
        setCanRetry(false);
        setStatus("done");
        setProgress(100);
        return outcome.result;
      }

      resumeRef.current = outcome.session ?? session;
      setStatus("error");
      setError(outcome.error?.message ?? "Upload failed. Please try again.");
      setCanRetry(true);
      return null;
    },
    [],
  );

  const upload = useCallback(
    async (
      file: File,
      metadata: ChunkedUploadMetadata,
      options: ChunkedUploadOptions = {},
    ): Promise<ChunkedUploadResult | null> => {
      setStatus("uploading");
      setProgress(0);
      setError(null);

      try {
        const initRes = await fetch("/api/admin/club-files/upload-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            declaredSize: file.size,
            ...(options.replaceFileId ? { replaceFileId: options.replaceFileId } : {}),
          }),
        });
        const { sessionId, chunkSize, totalChunks } = await readJsonOrThrow(
          initRes,
          "Could not start the upload.",
        );

        return await runSession({ file, metadata, sessionId, chunkSize, totalChunks, nextChunkIndex: 0 });
      } catch (err) {
        // Only reached if init itself failed — there is no session to
        // resume yet, so leave resumeRef untouched (it's already null).
        const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
        setStatus("error");
        setError(message);
        setCanRetry(resumeRef.current !== null);
        return null;
      }
    },
    [runSession],
  );

  /**
   * Retries after a failure. If every chunk had already landed (the failure
   * was in finalize), `resumeUpload` sees `nextChunkIndex === totalChunks`
   * and re-sends only the finalize call. Otherwise it resumes the chunk
   * loop at the first chunk that never succeeded — chunks before it are
   * already durable server-side and are never re-sent.
   */
  const retry = useCallback(async (): Promise<ChunkedUploadResult | null> => {
    const resume = resumeRef.current;
    if (!resume) return null;
    return runSession(resume);
  }, [runSession]);

  const reset = useCallback(() => {
    resumeRef.current = null;
    setCanRetry(false);
    setStatus("idle");
    setProgress(0);
    setError(null);
  }, []);

  return {
    status,
    progress,
    error,
    upload,
    /** Only meaningful once status === "error" and an init call has succeeded. */
    retry,
    canRetry,
    reset,
  };
}
