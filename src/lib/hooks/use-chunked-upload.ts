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
 *      only the finalize step, never re-uploads the chunks.
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

interface ResumeState {
  file: File;
  metadata: ChunkedUploadMetadata;
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  nextChunkIndex: number;
}

export function useChunkedUpload() {
  const [status, setStatus] = useState<ChunkedUploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const resumeRef = useRef<ResumeState | null>(null);

  const runFinalize = useCallback(
    async (sessionId: string, metadata: ChunkedUploadMetadata): Promise<ChunkedUploadResult> => {
      setStatus("finalizing");
      const res = await fetch(`/api/admin/club-files/upload-sessions/${sessionId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });
      const data = await readJsonOrThrow(res, "Could not finish the upload.");
      return { id: data.id as string, replaced: Boolean(data.replaced) };
    },
    [],
  );

  const runChunks = useCallback(
    async (
      file: File,
      metadata: ChunkedUploadMetadata,
      sessionId: string,
      chunkSize: number,
      totalChunks: number,
      startIndex: number,
    ): Promise<void> => {
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
            setProgress(Math.round((data.receivedChunks / data.totalChunks) * 100));
            ok = true;
          } catch (err) {
            lastError = err;
          }
        }

        if (!ok) {
          // Remember where we stopped so retry() can resume from this chunk
          // rather than re-uploading everything before it.
          resumeRef.current = { file, metadata, sessionId, chunkSize, totalChunks, nextChunkIndex: index };
          throw lastError instanceof Error ? lastError : new Error("Chunk upload failed.");
        }
      }
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

        resumeRef.current = { file, metadata, sessionId, chunkSize, totalChunks, nextChunkIndex: 0 };
        await runChunks(file, metadata, sessionId, chunkSize, totalChunks, 0);

        const result = await runFinalize(sessionId, metadata);
        resumeRef.current = null;
        setStatus("done");
        setProgress(100);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
        setStatus("error");
        setError(message);
        return null;
      }
    },
    [runChunks, runFinalize],
  );

  /**
   * Retries after a failure. If every chunk had already landed (the failure
   * was in finalize), this re-sends only the finalize call. Otherwise it
   * resumes the chunk loop at the first chunk that never succeeded — chunks
   * before it are already durable server-side and are never re-sent.
   */
  const retry = useCallback(async (): Promise<ChunkedUploadResult | null> => {
    const resume = resumeRef.current;
    if (!resume) return null;

    setStatus(resume.nextChunkIndex >= resume.totalChunks ? "finalizing" : "uploading");
    setError(null);

    try {
      if (resume.nextChunkIndex < resume.totalChunks) {
        await runChunks(
          resume.file,
          resume.metadata,
          resume.sessionId,
          resume.chunkSize,
          resume.totalChunks,
          resume.nextChunkIndex,
        );
      }
      const result = await runFinalize(resume.sessionId, resume.metadata);
      resumeRef.current = null;
      setStatus("done");
      setProgress(100);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setStatus("error");
      setError(message);
      return null;
    }
  }, [runChunks, runFinalize]);

  const reset = useCallback(() => {
    resumeRef.current = null;
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
    canRetry: resumeRef.current !== null,
    reset,
  };
}
