/**
 * Club Files — chunked-upload session protocol (init / chunk / finalize).
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "Upload Transport" /
 * "API Contract". DECISION-095 (chunked upload, not @vercel/blob transit).
 *
 * A 25MB file cannot cross a single Vercel Function's 4.5MB request-body
 * cap, so uploads go through a session: init allocates a session row and
 * returns the chunk plan, N raw-binary PUTs land 3MB chunks (idempotent by
 * construction via the `(session_id, chunk_index)` composite PK), and
 * finalize assembles, validates, and persists the bytes as one durable
 * club_files/club_file_blobs row.
 *
 * Permission gating (`club_files.manage`) is the CALLER's responsibility —
 * nothing in this file checks FEATURES, matching every other query module.
 */

import { db } from "@/lib/db";
import {
  clubFiles,
  clubFileUploadSessions,
  clubFileUploadChunks,
  type ClubFileUploadSession,
} from "@/lib/db/schema";
import { and, asc, eq, lt, ne } from "drizzle-orm";
import crypto from "crypto";
import { getClubFileStorage, sanitizeClubFileName } from "@/lib/club-file-storage";
import { validateMagicBytes } from "@/lib/receipt-magic-bytes";
import { isValidClubFileVisibility, type ClubFileVisibility } from "@/lib/club-files-queries";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 3 MiB — raw application/octet-stream chunk size (Phase 3 "Upload Transport"). */
export const CLUB_FILE_CHUNK_SIZE = 3 * 1024 * 1024; // 3,145,728 bytes

/** 25 MB declared-size cap, checked at session init. */
export const CLUB_FILE_MAX_DECLARED_SIZE = 25 * 1024 * 1024; // 26,214,400 bytes

/** Sessions older than this that never reached 'complete' are swept on the next init call. */
const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Stale-session sweep
// ---------------------------------------------------------------------------

/**
 * Deletes any upload session older than 24h that never reached
 * status='complete'. Cascades to its chunk rows via FK. No cron, no
 * background job — this is the whole cleanup story, called lazily at the
 * top of every init call.
 */
export async function sweepStaleUploadSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SESSION_MS);
  const deleted = await db
    .delete(clubFileUploadSessions)
    .where(and(ne(clubFileUploadSessions.status, "complete"), lt(clubFileUploadSessions.createdAt, cutoff)))
    .returning({ id: clubFileUploadSessions.id });
  return deleted.length;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export interface CreateUploadSessionInput {
  filename: string;
  declaredSize: number;
  replaceFileId?: string | null;
  createdByUserId: string;
}

export type CreateUploadSessionResult =
  | { ok: true; sessionId: string; chunkSize: number; totalChunks: number }
  | { ok: false; reason: "too_large" | "invalid_size" | "replace_target_not_found" };

export async function createUploadSession(
  input: CreateUploadSessionInput,
): Promise<CreateUploadSessionResult> {
  // "the next person to upload takes out yesterday's trash" — Phase 3.
  await sweepStaleUploadSessions();

  if (!Number.isInteger(input.declaredSize) || input.declaredSize <= 0) {
    return { ok: false, reason: "invalid_size" };
  }
  if (input.declaredSize > CLUB_FILE_MAX_DECLARED_SIZE) {
    return { ok: false, reason: "too_large" };
  }

  if (input.replaceFileId) {
    const target = await db
      .select({ id: clubFiles.id })
      .from(clubFiles)
      .where(eq(clubFiles.id, input.replaceFileId))
      .limit(1);
    if (target.length === 0) {
      return { ok: false, reason: "replace_target_not_found" };
    }
  }

  const totalChunks = Math.max(1, Math.ceil(input.declaredSize / CLUB_FILE_CHUNK_SIZE));

  const [created] = await db
    .insert(clubFileUploadSessions)
    .values({
      filename: input.filename,
      declaredSize: input.declaredSize,
      chunkSize: CLUB_FILE_CHUNK_SIZE,
      totalChunks,
      replaceFileId: input.replaceFileId ?? null,
      status: "uploading",
      createdByUserId: input.createdByUserId,
    })
    .returning({ id: clubFileUploadSessions.id });

  return { ok: true, sessionId: created.id, chunkSize: CLUB_FILE_CHUNK_SIZE, totalChunks };
}

export async function getUploadSession(sessionId: string): Promise<ClubFileUploadSession | null> {
  const rows = await db
    .select()
    .from(clubFileUploadSessions)
    .where(eq(clubFileUploadSessions.id, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Chunk PUT
// ---------------------------------------------------------------------------

export type PutUploadChunkResult =
  | { ok: true; chunkIndex: number; receivedChunks: number; totalChunks: number }
  | { ok: false; reason: "session_not_found" | "index_out_of_range" | "wrong_length" };

/**
 * Upserts one chunk by (sessionId, chunkIndex) — the composite PK makes a
 * re-PUT of the same index idempotent by construction (ON CONFLICT DO
 * UPDATE), so a client retry after a network blip is always safe. Chunks
 * may arrive out of order; the server doesn't require sequential delivery.
 */
export async function putUploadChunk(
  sessionId: string,
  chunkIndex: number,
  bytes: Buffer,
): Promise<PutUploadChunkResult> {
  const session = await getUploadSession(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    return { ok: false, reason: "index_out_of_range" };
  }

  const isLastChunk = chunkIndex === session.totalChunks - 1;
  const expectedLength = isLastChunk
    ? session.declaredSize - session.chunkSize * (session.totalChunks - 1)
    : session.chunkSize;

  if (bytes.byteLength !== expectedLength) {
    return { ok: false, reason: "wrong_length" };
  }

  await db
    .insert(clubFileUploadChunks)
    .values({ sessionId, chunkIndex, bytes, byteSize: bytes.byteLength })
    .onConflictDoUpdate({
      target: [clubFileUploadChunks.sessionId, clubFileUploadChunks.chunkIndex],
      set: { bytes, byteSize: bytes.byteLength },
    });

  const receivedRows = await db
    .select({ chunkIndex: clubFileUploadChunks.chunkIndex })
    .from(clubFileUploadChunks)
    .where(eq(clubFileUploadChunks.sessionId, sessionId));

  return {
    ok: true,
    chunkIndex,
    receivedChunks: receivedRows.length,
    totalChunks: session.totalChunks,
  };
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

export interface FinalizeUploadSessionInput {
  name?: string;
  description?: string | null;
  visibility?: ClubFileVisibility;
  checksumSha256?: string;
}

export type FinalizeUploadSessionResult =
  | { ok: true; fileId: string; replaced: boolean }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "missing_chunk"; missingIndex: number }
  | { ok: false; reason: "size_mismatch"; expected: number; actual: number }
  | { ok: false; reason: "checksum_mismatch" }
  | { ok: false; reason: "invalid_type" }
  | { ok: false; reason: "missing_metadata" };

/** Marks a session 'failed' without deleting it — the client can inspect/retry the failed step. */
async function markSessionFailed(sessionId: string): Promise<void> {
  await db
    .update(clubFileUploadSessions)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(clubFileUploadSessions.id, sessionId));
}

/** Success-path cleanup only — deletes the session and cascades its chunk rows. */
async function deleteUploadSession(sessionId: string): Promise<void> {
  await db.delete(clubFileUploadSessions).where(eq(clubFileUploadSessions.id, sessionId));
}

export async function finalizeUploadSession(
  sessionId: string,
  input: FinalizeUploadSessionInput,
): Promise<FinalizeUploadSessionResult> {
  const session = await getUploadSession(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };

  const isReplace = session.replaceFileId !== null;

  // New-file metadata is required; replace ignores name/description/visibility
  // and keeps the existing row's values (Phase 1 ruling).
  if (!isReplace) {
    if (!input.name || !input.name.trim() || !input.visibility || !isValidClubFileVisibility(input.visibility)) {
      return { ok: false, reason: "missing_metadata" };
    }
  }

  // 1. Confirm a contiguous 0..totalChunks-1 run with no gaps.
  const chunkRows = await db
    .select({ chunkIndex: clubFileUploadChunks.chunkIndex, bytes: clubFileUploadChunks.bytes })
    .from(clubFileUploadChunks)
    .where(eq(clubFileUploadChunks.sessionId, sessionId))
    .orderBy(asc(clubFileUploadChunks.chunkIndex));

  const present = new Set(chunkRows.map((c) => c.chunkIndex));
  for (let i = 0; i < session.totalChunks; i++) {
    if (!present.has(i)) {
      await markSessionFailed(sessionId);
      return { ok: false, reason: "missing_chunk", missingIndex: i };
    }
  }

  // 2. Assemble in chunkIndex order (query already ordered asc).
  const assembled = Buffer.concat(chunkRows.map((c) => c.bytes));

  // 3. Size check.
  if (assembled.byteLength !== session.declaredSize) {
    await markSessionFailed(sessionId);
    return {
      ok: false,
      reason: "size_mismatch",
      expected: session.declaredSize,
      actual: assembled.byteLength,
    };
  }

  // 4. Optional checksum.
  if (input.checksumSha256) {
    const actualChecksum = crypto.createHash("sha256").update(assembled).digest("hex");
    if (actualChecksum.toLowerCase() !== input.checksumSha256.toLowerCase()) {
      await markSessionFailed(sessionId);
      return { ok: false, reason: "checksum_mismatch" };
    }
  }

  // 5. Magic-byte validation — PDF only in v1 (reuses the existing receipt validator).
  const detectedType = validateMagicBytes(assembled);
  if (detectedType !== "application/pdf") {
    await markSessionFailed(sessionId);
    return { ok: false, reason: "invalid_type" };
  }

  const uuid = crypto.randomUUID();
  const safeName = sanitizeClubFileName(session.filename || "file.pdf");
  const newKey = `club-files/${uuid}/${safeName}`;

  const storage = getClubFileStorage();

  if (isReplace && session.replaceFileId) {
    // Write the new blob FIRST, under a brand-new key — old bytes remain
    // servable under the old key through every step up to the UPDATE below
    // (Phase 3 "Replace-in-place atomicity").
    await storage.save(newKey, assembled, "application/pdf");

    const replaceResult = await db.transaction(async (tx) => {
      // Row lock captures the old key and serializes concurrent replaces of
      // the same file — a second finalize simply waits, then correctly
      // sees this replace's new key as "old" when its own turn comes.
      const locked = await tx
        .select({ storageKey: clubFiles.storageKey })
        .from(clubFiles)
        .where(eq(clubFiles.id, session.replaceFileId!))
        .for("update");
      const oldKey = locked[0]?.storageKey;
      if (!oldKey) {
        // Defensive only — replaceFileId is FK ON DELETE CASCADE to
        // clubFiles, so a deleted target would have cascaded this session
        // away already. Should be unreachable in practice.
        return null;
      }

      await tx
        .update(clubFiles)
        .set({
          storageKey: newKey,
          filename: safeName,
          byteSize: assembled.byteLength,
          contentType: "application/pdf",
          updatedAt: new Date(),
        })
        .where(eq(clubFiles.id, session.replaceFileId!));

      return { fileId: session.replaceFileId!, oldKey };
    });

    if (!replaceResult) {
      // Target vanished underneath us — leave the session alive, do not
      // delete anything further; the new blob is orphaned but harmless.
      await markSessionFailed(sessionId);
      return { ok: false, reason: "session_not_found" };
    }

    // Only after the UPDATE has committed do we remove the old blob.
    await storage.delete(replaceResult.oldKey);
    await deleteUploadSession(sessionId);

    return { ok: true, fileId: replaceResult.fileId, replaced: true };
  }

  // Non-replace: new club_files row + new blob.
  await storage.save(newKey, assembled, "application/pdf");

  const [inserted] = await db
    .insert(clubFiles)
    .values({
      name: input.name!.trim(),
      description: input.description ?? null,
      visibility: input.visibility!,
      filename: safeName,
      contentType: "application/pdf",
      byteSize: assembled.byteLength,
      storageKey: newKey,
      uploadedByUserId: session.createdByUserId ?? null,
    })
    .returning({ id: clubFiles.id });

  await deleteUploadSession(sessionId);

  return { ok: true, fileId: inserted.id, replaced: false };
}
