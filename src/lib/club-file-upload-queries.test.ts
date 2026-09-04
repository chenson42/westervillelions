/**
 * Unit tests for the Club Files chunked-upload session protocol
 * (docs/work-log/2026-09-04-club-documents.md, Phase 3 "Upload Transport",
 * "Unit Tests Required"). Covers:
 *
 *   - stale (>24h, non-'complete') session sweep on init
 *   - declaredSize over the 25MB cap rejected
 *   - chunk PUT: wrong byte length rejected (non-final chunk), out-of-range
 *     index rejected, idempotent re-PUT of the same index
 *   - finalize: missing/gapped chunk rejected, size mismatch rejected,
 *     checksum mismatch rejected, magic-byte rejection (including a
 *     genuinely valid JPEG rejected because Club Files is PDF-only in v1),
 *     happy-path create, happy-path replace atomicity
 *
 * Hermetic: mocks @/lib/db (hand-wired chains, matching this codebase's
 * convention in e.g. src/app/api/admin/ledger/transactions/[id]/split/
 * route.test.ts) and @/lib/club-file-storage's getClubFileStorage() only —
 * sanitizeClubFileName stays real via importOriginal. validateMagicBytes is
 * NOT mocked; tests exercise the real function against real magic-byte
 * buffers, matching src/lib/receipt-storage/receipt-storage.test.ts's
 * approach for the sibling feature. Does not exercise real Postgres bytea
 * wire encoding or FK cascade behavior — those are closed at the
 * integration level (QA Phase 5's dev-server smoke test), not here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// @/lib/db mock — chainable builder shared across select/insert/update/delete
// ---------------------------------------------------------------------------

const { dbState } = vi.hoisted(() => ({
  dbState: {
    selectImpls: [] as Array<() => unknown>,
    insertReturningRows: [] as unknown[],
    insertValuesCalls: [] as unknown[],
    onConflictArgs: [] as unknown[],
    updateSetCalls: [] as unknown[],
    deleteReturningRows: [] as unknown[],
    deleteCallCount: 0,
    txSelectRows: [] as unknown[],
    txUpdateSetCalls: [] as unknown[],
    txShouldThrow: false as boolean,
  },
}));

function selectChain(rows: unknown[]) {
  const resolved = Promise.resolve(rows);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => resolved,
    orderBy: () => resolved,
    for: () => resolved,
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => resolved.then(res, rej),
  };
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const impl = dbState.selectImpls.shift();
      return selectChain(impl ? (impl() as unknown[]) : []);
    }),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        dbState.insertValuesCalls.push(v);
        return {
          returning: () => Promise.resolve(dbState.insertReturningRows),
          onConflictDoUpdate: (arg: unknown) => {
            dbState.onConflictArgs.push(arg);
            return Promise.resolve(undefined);
          },
        };
      },
    })),
    update: vi.fn(() => ({
      set: (v: unknown) => {
        dbState.updateSetCalls.push(v);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
    delete: vi.fn(() => {
      dbState.deleteCallCount++;
      const resolved = Promise.resolve(undefined);
      return {
        where: () => ({
          returning: () => Promise.resolve(dbState.deleteReturningRows),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => resolved.then(res, rej),
        }),
      };
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        select: () => selectChain(dbState.txSelectRows),
        update: () => ({
          set: (v: unknown) => {
            dbState.txUpdateSetCalls.push(v);
            return {
              where: () => {
                if (dbState.txShouldThrow) {
                  return Promise.reject(new Error("simulated transaction failure"));
                }
                return Promise.resolve(undefined);
              },
            };
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

// ---------------------------------------------------------------------------
// @/lib/club-file-storage mock — getClubFileStorage() only, keep
// sanitizeClubFileName real.
// ---------------------------------------------------------------------------

const storageSpies = {
  save: vi.fn(() => Promise.resolve(undefined)),
  read: vi.fn(() => Promise.resolve(null)),
  delete: vi.fn(() => Promise.resolve(undefined)),
};

vi.mock("@/lib/club-file-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./club-file-storage")>();
  return {
    ...actual,
    getClubFileStorage: vi.fn(() => storageSpies),
  };
});

import {
  sweepStaleUploadSessions,
  createUploadSession,
  putUploadChunk,
  finalizeUploadSession,
  CLUB_FILE_MAX_DECLARED_SIZE,
} from "./club-file-upload-queries";

function resetDbState() {
  dbState.selectImpls = [];
  dbState.insertReturningRows = [];
  dbState.insertValuesCalls = [];
  dbState.onConflictArgs = [];
  dbState.updateSetCalls = [];
  dbState.deleteReturningRows = [];
  dbState.deleteCallCount = 0;
  dbState.txSelectRows = [];
  dbState.txUpdateSetCalls = [];
  dbState.txShouldThrow = false;
}

beforeEach(() => {
  resetDbState();
  storageSpies.save.mockClear();
  storageSpies.read.mockClear();
  storageSpies.delete.mockClear();
});

const BASE_SESSION = {
  id: "sess-1",
  filename: "packet.pdf",
  declaredSize: 20,
  chunkSize: 10,
  totalChunks: 2,
  replaceFileId: null as string | null,
  status: "uploading",
  createdByUserId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// sweepStaleUploadSessions
// ---------------------------------------------------------------------------

describe("sweepStaleUploadSessions", () => {
  it("deletes stale sessions and returns the count deleted", async () => {
    dbState.deleteReturningRows = [{ id: "old-1" }, { id: "old-2" }];

    const count = await sweepStaleUploadSessions();

    expect(count).toBe(2);
    expect(dbState.deleteCallCount).toBe(1);
  });

  it("returns 0 when nothing is stale", async () => {
    dbState.deleteReturningRows = [];
    const count = await sweepStaleUploadSessions();
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createUploadSession
// ---------------------------------------------------------------------------

describe("createUploadSession", () => {
  it("sweeps stale sessions before creating a new one", async () => {
    dbState.deleteReturningRows = [{ id: "orphan-1" }]; // simulates one prior orphaned session swept
    dbState.insertReturningRows = [{ id: "new-session-1" }];

    await createUploadSession({
      filename: "packet.pdf",
      declaredSize: 1000,
      createdByUserId: "user-1",
    });

    expect(dbState.deleteCallCount).toBe(1);
  });

  it("rejects a declaredSize over the 25MB cap", async () => {
    dbState.insertReturningRows = [{ id: "should-not-be-used" }];

    const result = await createUploadSession({
      filename: "big.pdf",
      declaredSize: CLUB_FILE_MAX_DECLARED_SIZE + 1,
      createdByUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, reason: "too_large" });
    expect(dbState.insertValuesCalls).toHaveLength(0);
  });

  it("accepts a declaredSize exactly at the 25MB cap", async () => {
    dbState.insertReturningRows = [{ id: "new-session-2" }];

    const result = await createUploadSession({
      filename: "exact.pdf",
      declaredSize: CLUB_FILE_MAX_DECLARED_SIZE,
      createdByUserId: "user-1",
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a zero or negative declaredSize", async () => {
    const result = await createUploadSession({
      filename: "bad.pdf",
      declaredSize: 0,
      createdByUserId: "user-1",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_size" });
  });

  it("returns replace_target_not_found when replaceFileId doesn't resolve to an existing file", async () => {
    dbState.selectImpls.push(() => []); // the replaceFileId existence check

    const result = await createUploadSession({
      filename: "packet.pdf",
      declaredSize: 1000,
      replaceFileId: "ghost-file",
      createdByUserId: "user-1",
    });

    expect(result).toEqual({ ok: false, reason: "replace_target_not_found" });
  });

  it("computes totalChunks as ceil(declaredSize / chunkSize) and returns the session plan", async () => {
    dbState.selectImpls.push(() => [{ id: "existing-file" }]); // replaceFileId exists
    dbState.insertReturningRows = [{ id: "new-session-3" }];

    const result = await createUploadSession({
      filename: "packet.pdf",
      declaredSize: 7_000_000, // just over 2 chunks of 3,145,728
      replaceFileId: "existing-file",
      createdByUserId: "user-1",
    });

    expect(result).toEqual({
      ok: true,
      sessionId: "new-session-3",
      chunkSize: 3 * 1024 * 1024,
      totalChunks: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// putUploadChunk
// ---------------------------------------------------------------------------

describe("putUploadChunk", () => {
  it("rejects an out-of-range chunk index", async () => {
    dbState.selectImpls.push(() => [BASE_SESSION]); // getUploadSession

    const result = await putUploadChunk("sess-1", 5, Buffer.alloc(10));

    expect(result).toEqual({ ok: false, reason: "index_out_of_range" });
  });

  it("rejects a negative chunk index", async () => {
    dbState.selectImpls.push(() => [BASE_SESSION]);
    const result = await putUploadChunk("sess-1", -1, Buffer.alloc(10));
    expect(result).toEqual({ ok: false, reason: "index_out_of_range" });
  });

  it("returns session_not_found for an unknown session id", async () => {
    dbState.selectImpls.push(() => []); // getUploadSession finds nothing

    const result = await putUploadChunk("ghost-session", 0, Buffer.alloc(10));

    expect(result).toEqual({ ok: false, reason: "session_not_found" });
  });

  it("rejects a non-final chunk whose byte length doesn't match chunkSize", async () => {
    dbState.selectImpls.push(() => [BASE_SESSION]); // getUploadSession

    // BASE_SESSION.chunkSize = 10; sending 5 bytes for chunk 0 (non-final of 2) is wrong.
    const result = await putUploadChunk("sess-1", 0, Buffer.alloc(5));

    expect(result).toEqual({ ok: false, reason: "wrong_length" });
  });

  it("rejects a final chunk whose byte length doesn't match the declared remainder", async () => {
    dbState.selectImpls.push(() => [BASE_SESSION]); // getUploadSession
    // declaredSize=20, chunkSize=10, totalChunks=2 -> chunk 1 (final) must be 10 bytes.
    const result = await putUploadChunk("sess-1", 1, Buffer.alloc(3));
    expect(result).toEqual({ ok: false, reason: "wrong_length" });
  });

  it("accepts a correctly-sized chunk and reports receivedChunks/totalChunks from the response", async () => {
    dbState.selectImpls.push(() => [BASE_SESSION]); // getUploadSession
    dbState.selectImpls.push(() => [{ chunkIndex: 0 }]); // receivedRows count after upsert

    const result = await putUploadChunk("sess-1", 0, Buffer.alloc(10));

    expect(result).toEqual({ ok: true, chunkIndex: 0, receivedChunks: 1, totalChunks: 2 });
    expect(dbState.onConflictArgs).toHaveLength(1);
  });

  it("re-PUTting the same index twice succeeds and stores the latest bytes (idempotent retry)", async () => {
    // First PUT
    dbState.selectImpls.push(() => [BASE_SESSION]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0 }]);
    const first = await putUploadChunk("sess-1", 0, Buffer.from("aaaaaaaaaa")); // 10 bytes

    // Second PUT of the SAME index — must not error, and receivedChunks stays 1
    // (upsert, not a second row).
    dbState.selectImpls.push(() => [BASE_SESSION]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0 }]);
    const second = await putUploadChunk("sess-1", 0, Buffer.from("bbbbbbbbbb")); // 10 bytes, different content

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: true, chunkIndex: 0, receivedChunks: 1, totalChunks: 2 });
    // The upsert path (onConflictDoUpdate) was invoked both times — no unique
    // constraint violation, no throw.
    expect(dbState.onConflictArgs).toHaveLength(2);
    // The second upsert's `set` carries the NEW bytes — "latest bytes win".
    const secondSetArg = dbState.insertValuesCalls[1] as { bytes: Buffer };
    expect(secondSetArg.bytes.toString()).toBe("bbbbbbbbbb");
  });
});

// ---------------------------------------------------------------------------
// finalizeUploadSession
// ---------------------------------------------------------------------------

const PDF_BYTES = Buffer.from("%PDF-1.4 mock content for club files");
// Real JPEG magic bytes (FF D8 FF E0) — genuinely valid image data, still
// rejected because Club Files is PDF-only in v1.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function newFileSession(overrides: Partial<typeof BASE_SESSION> = {}) {
  return { ...BASE_SESSION, replaceFileId: null, ...overrides };
}

describe("finalizeUploadSession", () => {
  it("returns session_not_found for an unknown session id", async () => {
    dbState.selectImpls.push(() => []); // getUploadSession
    const result = await finalizeUploadSession("ghost", {});
    expect(result).toEqual({ ok: false, reason: "session_not_found" });
  });

  it("returns missing_metadata when creating a new file without name/visibility", async () => {
    dbState.selectImpls.push(() => [newFileSession()]); // getUploadSession
    const result = await finalizeUploadSession("sess-1", {});
    expect(result).toEqual({ ok: false, reason: "missing_metadata" });
  });

  it("rejects a gapped/missing chunk and leaves the session alive (not deleted)", async () => {
    const session = newFileSession({ declaredSize: 30, chunkSize: 10, totalChunks: 3 });
    dbState.selectImpls.push(() => [session]); // getUploadSession
    // Only chunks 0 and 2 present — chunk 1 is missing.
    dbState.selectImpls.push(() => [
      { chunkIndex: 0, bytes: Buffer.alloc(10) },
      { chunkIndex: 2, bytes: Buffer.alloc(10) },
    ]);

    const result = await finalizeUploadSession("sess-1", {
      name: "Packet",
      visibility: "public",
    });

    expect(result).toEqual({ ok: false, reason: "missing_chunk", missingIndex: 1 });
    // Marked failed via db.update, never deleted via db.delete.
    expect(dbState.updateSetCalls).toHaveLength(1);
    expect((dbState.updateSetCalls[0] as { status: string }).status).toBe("failed");
    expect(dbState.deleteCallCount).toBe(0);
  });

  it("rejects an assembled size that doesn't match declaredSize (chunk-assembly mismatch) and leaves the session alive", async () => {
    const session = newFileSession({ declaredSize: 999, chunkSize: 10, totalChunks: 1 });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: Buffer.alloc(10) }]);

    const result = await finalizeUploadSession("sess-1", { name: "Packet", visibility: "public" });

    expect(result).toEqual({ ok: false, reason: "size_mismatch", expected: 999, actual: 10 });
    expect(dbState.deleteCallCount).toBe(0);
    expect(storageSpies.save).not.toHaveBeenCalled();
  });

  it("rejects a checksum mismatch and leaves the session alive", async () => {
    const session = newFileSession({ declaredSize: PDF_BYTES.byteLength, chunkSize: PDF_BYTES.byteLength, totalChunks: 1 });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: PDF_BYTES }]);

    const result = await finalizeUploadSession("sess-1", {
      name: "Packet",
      visibility: "public",
      checksumSha256: "0000000000000000000000000000000000000000000000000000000000000",
    });

    expect(result).toEqual({ ok: false, reason: "checksum_mismatch" });
    expect(dbState.deleteCallCount).toBe(0);
    expect(storageSpies.save).not.toHaveBeenCalled();
  });

  it("accepts a matching checksum and proceeds to create the file", async () => {
    const session = newFileSession({ declaredSize: PDF_BYTES.byteLength, chunkSize: PDF_BYTES.byteLength, totalChunks: 1 });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: PDF_BYTES }]);
    dbState.insertReturningRows = [{ id: "file-1" }];

    const crypto = await import("crypto");
    const correctChecksum = crypto.createHash("sha256").update(PDF_BYTES).digest("hex");

    const result = await finalizeUploadSession("sess-1", {
      name: "Packet",
      visibility: "public",
      checksumSha256: correctChecksum,
    });

    expect(result).toEqual({ ok: true, fileId: "file-1", replaced: false });
  });

  it("rejects a genuinely valid JPEG — Club Files is PDF-only in v1 (magic-byte rejection)", async () => {
    const session = newFileSession({ declaredSize: JPEG_BYTES.byteLength, chunkSize: JPEG_BYTES.byteLength, totalChunks: 1 });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: JPEG_BYTES }]);

    const result = await finalizeUploadSession("sess-1", { name: "Packet", visibility: "public" });

    expect(result).toEqual({ ok: false, reason: "invalid_type" });
    expect(storageSpies.save).not.toHaveBeenCalled();
  });

  it("happy path: creates a new club_files row and deletes the session on success", async () => {
    const session = newFileSession({ declaredSize: PDF_BYTES.byteLength, chunkSize: PDF_BYTES.byteLength, totalChunks: 1 });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: PDF_BYTES }]);
    dbState.insertReturningRows = [{ id: "file-42" }];

    const result = await finalizeUploadSession("sess-1", {
      name: "Sponsor Packet",
      description: "2026 Rudolph Run",
      visibility: "public",
    });

    expect(result).toEqual({ ok: true, fileId: "file-42", replaced: false });
    expect(storageSpies.save).toHaveBeenCalledTimes(1);
    expect(dbState.deleteCallCount).toBe(1); // deleteUploadSession success cleanup
    const inserted = dbState.insertValuesCalls[0] as { name: string; visibility: string };
    expect(inserted.name).toBe("Sponsor Packet");
    expect(inserted.visibility).toBe("public");
  });

  it("happy-path replace: locks the old row, flips storageKey, deletes the old blob only after the update commits", async () => {
    const session = newFileSession({
      declaredSize: PDF_BYTES.byteLength,
      chunkSize: PDF_BYTES.byteLength,
      totalChunks: 1,
      replaceFileId: "file-to-replace",
    });
    dbState.selectImpls.push(() => [session]); // getUploadSession
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: PDF_BYTES }]); // chunk rows
    dbState.txSelectRows = [{ storageKey: "club-files/old-uuid/old.pdf" }]; // FOR UPDATE lock read

    const result = await finalizeUploadSession("sess-1", {});

    expect(result).toEqual({ ok: true, fileId: "file-to-replace", replaced: true });
    // New blob written before the row flips...
    expect(storageSpies.save).toHaveBeenCalledTimes(1);
    // ...old blob deleted only after — same call, so we assert both happened
    // and the delete targeted the OLD key, not the new one.
    expect(storageSpies.delete).toHaveBeenCalledWith("club-files/old-uuid/old.pdf");
    expect(dbState.txUpdateSetCalls).toHaveLength(1);
    expect(dbState.deleteCallCount).toBe(1); // deleteUploadSession success cleanup
  });

  it("replace atomicity: if the transaction fails after chunks are uploaded, the old blob is never deleted and the session survives", async () => {
    const session = newFileSession({
      declaredSize: PDF_BYTES.byteLength,
      chunkSize: PDF_BYTES.byteLength,
      totalChunks: 1,
      replaceFileId: "file-to-replace",
    });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: PDF_BYTES }]);
    dbState.txSelectRows = [{ storageKey: "club-files/old-uuid/old.pdf" }];
    dbState.txShouldThrow = true; // simulate the UPDATE failing inside the transaction

    await expect(finalizeUploadSession("sess-1", {})).rejects.toThrow();

    // The old blob must NOT have been deleted — the failed UPDATE never
    // committed, so the original row's storageKey still points at it.
    expect(storageSpies.delete).not.toHaveBeenCalled();
    // The session cleanup (delete) never runs either — it's after the
    // transaction in source order.
    expect(dbState.deleteCallCount).toBe(0);
  });

  it("replace ignores name/description/visibility from the request body", async () => {
    const session = newFileSession({
      declaredSize: PDF_BYTES.byteLength,
      chunkSize: PDF_BYTES.byteLength,
      totalChunks: 1,
      replaceFileId: "file-to-replace",
    });
    dbState.selectImpls.push(() => [session]);
    dbState.selectImpls.push(() => [{ chunkIndex: 0, bytes: PDF_BYTES }]);
    dbState.txSelectRows = [{ storageKey: "club-files/old-uuid/old.pdf" }];

    // No name/visibility supplied — must NOT be rejected as missing_metadata
    // because this session is a replace.
    const result = await finalizeUploadSession("sess-1", {});

    expect(result.ok).toBe(true);
  });
});
