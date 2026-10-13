/**
 * Upload orchestration with @/lib/db mocked and the in-memory photo store: validation
 * happens before any store call, a replay does not upload again, a refused commit
 * deletes what it just uploaded, and a store outage throws before any database write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { st } = vi.hoisted(() => ({
  st: {
    existingPhoto: null as Row | null,
    /** Successive answers to the `select({ n })` queries: device uploads (crew only), then bytes used. */
    nQueue: [] as number[],
    /** After a failed commit, does the photo row exist? (a replay owns the keys) */
    rowExistsAfter: false,
    selectCount: 0,
    sessionUpdates: 0,
    groupInsertRows: [{ id: "g" }] as Row[],
    groupInserts: [] as Row[],
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    db: {
      select: (arg?: Row) => ({
        from: () => ({
          where: () => {
            const answer = (): Row[] => {
              if (arg && "n" in arg) return [{ n: st.nQueue.shift() ?? 0 }];
              st.selectCount += 1;
              if (arg && Object.keys(arg).length === 1 && "id" in arg) return st.rowExistsAfter ? [{ id: "x" }] : [];
              return st.existingPhoto ? [st.existingPhoto] : [];
            };
            return Object.assign(Promise.resolve().then(answer), { limit: async () => answer() });
          },
        }),
      }),
      update: (t: unknown) => ({
        set: () => ({
          where: async () => {
            if (t === schema.swSessions) st.sessionUpdates += 1;
          },
        }),
      }),
      insert: () => ({
        values: (v: Row) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              st.groupInserts.push(v);
              return st.groupInsertRows;
            },
          }),
        }),
      }),
    },
  };
});

import type { SwSession } from "@/lib/db/schema";
import { commitGroupPhoto, ingestPhoto, isUploadRefusal, parsePhotoMeta, type UploadedPhoto } from "./photo-service";
import { makeJpeg, UUID_A, UUID_B, UUID_C } from "./photo-fixtures";
import { createMemoryPhotoStore } from "./photo-store/memory";
import { StorageUnavailable } from "./photo-store/errors";
import type { WriteContext } from "./stuffy-transitions";

const session = (over: Partial<SwSession> = {}): SwSession =>
  ({ id: UUID_A, slug: "practice-a", storageFolderKey: null, storageQuotaBytes: 10_000_000, ...over }) as SwSession;
const crew: WriteContext = { sessionId: UUID_A, sessionKind: "practice", actor: { kind: "crew", deviceId: "d".repeat(22), codeVersion: 1 } };
const admin: WriteContext = { sessionId: UUID_A, sessionKind: "practice", actor: { kind: "admin", userId: "u1" } };

const meta = { photoId: UUID_B, takenAt: "2026-12-18T22:00:00Z", width: 800, height: 600, thumbWidth: 320, thumbHeight: 240 };
const parts = () => ({ meta: {}, full: makeJpeg(800, 600), thumb: makeJpeg(320, 240) });

beforeEach(() => {
  st.existingPhoto = null;
  st.nQueue = [0, 0];
  st.rowExistsAfter = false;
  st.selectCount = 0;
  st.sessionUpdates = 0;
  st.groupInsertRows = [{ id: "g" }];
  st.groupInserts = [];
});

function run(over: Partial<Parameters<typeof ingestPhoto>[0]> = {}) {
  const store = createMemoryPhotoStore();
  const commit = vi.fn(async (_p: UploadedPhoto) => ({ ok: true as boolean }));
  const args = { ctx: crew, session: session(), kind: "portrait" as const, stuffyId: UUID_C, parts: parts(), meta, attempt: 1, commit, store, ...over };
  return { store, commit, result: ingestPhoto(args as Parameters<typeof ingestPhoto>[0]) };
}

describe("parsePhotoMeta", () => {
  it("accepts a complete meta and lowercases the photo id", () => {
    const r = parsePhotoMeta({ ...meta, photoId: UUID_B.toUpperCase() }, true);
    expect(r).toMatchObject({ ok: true, value: { photoId: UUID_B, width: 800 } });
  });
  it("needs a uuid, a time, integer sizes and (for a thumb kind) the preview size", () => {
    expect(parsePhotoMeta({ ...meta, photoId: "x" }, true).ok).toBe(false);
    expect(parsePhotoMeta({ ...meta, takenAt: "later" }, true).ok).toBe(false);
    expect(parsePhotoMeta({ ...meta, width: 1.5 }, true).ok).toBe(false);
    expect(parsePhotoMeta({ ...meta, thumbWidth: undefined }, true).ok).toBe(false);
    expect(parsePhotoMeta({ ...meta, thumbWidth: undefined }, false).ok).toBe(true);
    expect(parsePhotoMeta(null, false).ok).toBe(false);
  });
});

describe("ingestPhoto", () => {
  it("stores full and thumb in the session folder, then commits with the keys and a sha256", async () => {
    const { store, commit, result } = run();
    const out = await result;
    expect(out).toMatchObject({ ok: true });
    expect(commit).toHaveBeenCalledTimes(1);
    const photo = commit.mock.calls[0][0];
    expect(photo).toMatchObject({ id: UUID_B, kind: "portrait", width: 800, height: 600, contentType: "image/jpeg" });
    expect(photo.storageKey).toBeTruthy();
    expect(photo.thumbStorageKey).toBeTruthy();
    expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.size()).toBe(2);
    expect(st.sessionUpdates).toBe(1); // the folder key is remembered on the session
  });

  it("a check-in photo has no thumb part", async () => {
    const { store, commit, result } = run({ kind: "check_in", parts: { meta: {}, full: makeJpeg(800, 600), thumb: null } });
    await result;
    expect(commit.mock.calls[0][0].thumbStorageKey).toBeNull();
    expect(store.size()).toBe(1);
  });

  it("validation failures are refusals and reach neither the store nor the commit", async () => {
    const bad = run({ parts: { meta: {}, full: Uint8Array.of(1, 2, 3), thumb: makeJpeg(320, 240) } });
    const out = await bad.result;
    expect(isUploadRefusal(out) && out.code).toBe("not_jpeg");
    expect(bad.store.size()).toBe(0);
    expect(bad.commit).not.toHaveBeenCalled();

    const mismatch = run({ meta: { ...meta, width: 801 } });
    expect(await mismatch.result).toMatchObject({ ok: false, code: "invalid_input" });

    const noThumb = run({ parts: { meta: {}, full: makeJpeg(800, 600), thumb: null } });
    expect(await noThumb.result).toMatchObject({ ok: false, code: "invalid_input" });
    const noFull = run({ parts: { meta: {}, full: null, thumb: null } });
    expect(await noFull.result).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("a replay (the photo row already exists) skips the upload and commits the stored keys", async () => {
    st.existingPhoto = { id: UUID_B, sessionId: UUID_A, stuffyId: UUID_C, kind: "portrait", storageKind: "local", storageKey: "k1", thumbStorageKey: "k2", contentType: "image/jpeg", byteSize: 5, thumbByteSize: 2, width: 800, height: 600, sha256: "ab", takenAt: new Date("2026-12-18T22:00:00Z") };
    const { store, commit, result } = run();
    await result;
    expect(store.size()).toBe(0);
    expect(commit.mock.calls[0][0]).toMatchObject({ storageKey: "k1", thumbStorageKey: "k2" });
  });

  it("a photo id already used for another stuffy or kind is refused", async () => {
    st.existingPhoto = { id: UUID_B, sessionId: UUID_A, stuffyId: "someone-else", kind: "portrait" };
    const out = await run().result;
    expect(out).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("a device that uploaded 12 photos in the last minute is rate limited (crew only)", async () => {
    st.nQueue = [12, 0];
    const crewOut = await run().result;
    expect(crewOut).toMatchObject({ ok: false, code: "rate_limited" });
    st.nQueue = [0];
    const adminOut = await run({ ctx: admin }).result;
    expect(adminOut).toMatchObject({ ok: true });
  });

  it("a session over its storage quota is refused before any upload", async () => {
    st.nQueue = [0, 9_999_999];
    const r = run();
    expect(await r.result).toMatchObject({ ok: false, code: "quota_exceeded" });
    expect(r.store.size()).toBe(0);
  });

  it("a refused commit (409) deletes what it just uploaded", async () => {
    const store = createMemoryPhotoStore();
    const out = await ingestPhoto({ ctx: crew, session: session(), kind: "portrait", stuffyId: UUID_C, parts: parts(), meta, attempt: 1, commit: async () => ({ ok: false }), store });
    expect(out).toMatchObject({ ok: false });
    expect(store.size()).toBe(0);
  });

  it("but not when the photo row exists (it owns the keys)", async () => {
    st.rowExistsAfter = true;
    const store = createMemoryPhotoStore();
    await ingestPhoto({ ctx: crew, session: session(), kind: "portrait", stuffyId: UUID_C, parts: parts(), meta, attempt: 1, commit: async () => ({ ok: false }), store });
    expect(store.size()).toBe(2);
  });

  it("a commit that throws also cleans up and rethrows", async () => {
    const store = createMemoryPhotoStore();
    await expect(
      ingestPhoto({ ctx: crew, session: session(), kind: "portrait", stuffyId: UUID_C, parts: parts(), meta, attempt: 1, commit: async () => { throw new Error("db down"); }, store }),
    ).rejects.toThrow("db down");
    expect(store.size()).toBe(0);
  });

  it("a store outage throws StorageUnavailable and the commit is never reached (nothing in the database)", async () => {
    const store = createMemoryPhotoStore();
    store.setFailing(true);
    const commit = vi.fn(async () => ({ ok: true }));
    await expect(ingestPhoto({ ctx: crew, session: session({ storageFolderKey: "folder" }), kind: "portrait", stuffyId: UUID_C, parts: parts(), meta, attempt: 1, commit, store })).rejects.toBeInstanceOf(StorageUnavailable);
    expect(commit).not.toHaveBeenCalled();
  });

  it("a retry passes its attempt number to the store so Drive can look the file up first", async () => {
    const store = createMemoryPhotoStore();
    const put = vi.spyOn(store, "put");
    await ingestPhoto({ ctx: crew, session: session({ storageFolderKey: "folder" }), kind: "check_in", stuffyId: UUID_C, parts: { meta: {}, full: makeJpeg(800, 600), thumb: null }, meta, attempt: 3, commit: async () => ({ ok: true }), store });
    expect(put.mock.calls[0][0]).toMatchObject({ attempt: 3, folderKey: "folder", variant: "full" });
  });
});

describe("group photos", () => {
  it("are one unlinked row, idempotent on the photo id", async () => {
    const photo = { id: UUID_B, kind: "group", storageKind: "local", storageKey: "k", thumbStorageKey: "t", contentType: "image/jpeg", byteSize: 1, thumbByteSize: 1, width: 1, height: 1, sha256: "x", takenAt: new Date() } as UploadedPhoto;
    expect(await commitGroupPhoto(crew, photo)).toEqual({ ok: true, replayed: false });
    expect(st.groupInserts[0]).toMatchObject({ stuffyId: null, kind: "group", deviceId: "d".repeat(22), recordedByUserId: null });
    st.groupInsertRows = [];
    expect(await commitGroupPhoto(admin, photo)).toEqual({ ok: true, replayed: true });
    expect(st.groupInserts[1]).toMatchObject({ deviceId: "admin", recordedByUserId: "u1" });
  });
});
