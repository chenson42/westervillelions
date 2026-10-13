import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { st } = vi.hoisted(() => ({
  st: { photoRows: [] as Row[], sessions: [{ id: "11111111-1111-4111-8111-111111111111" }] as Row[], logs: [] as { sessionId: string; kind: string; detail: Row }[] },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    db: {
      select: () => ({
        from: (t: unknown) => {
          const rows = () => (t === schema.swPhotos ? st.photoRows : st.sessions);
          return {
            where: () => Object.assign(Promise.resolve().then(rows), { limit: async () => rows() }),
            orderBy: () => ({ limit: async () => rows() }),
          };
        },
      }),
    },
  };
});

vi.mock("./session-log", () => ({
  logSessionEvent: async (sessionId: string, _user: string, kind: string, detail: Row) => {
    st.logs.push({ sessionId, kind, detail });
  },
}));

import type { SwSession } from "@/lib/db/schema";
import { CHECK_MAX_PAGES, ORPHAN_MIN_AGE_MS, checkStorage, compareStorage, listFolder, runStorageTest } from "./storage-admin";
import { createMemoryPhotoStore } from "./photo-store/memory";
import { StorageUnavailable } from "./photo-store/errors";
import { storageBannerCause } from "./storage-status";
import { UUID_A, UUID_B, UUID_C } from "./photo-fixtures";

const NOW = new Date("2026-12-18T22:00:00Z");
const old = new Date(NOW.getTime() - ORPHAN_MIN_AGE_MS - 1000);
const young = new Date(NOW.getTime() - 60 * 1000);

beforeEach(() => {
  st.photoRows = [];
  st.logs = [];
});

describe("compareStorage", () => {
  const keys = new Map([
    ["k-full", { photoId: UUID_A, variant: "full" as const, size: 10, createdAt: old }],
    ["k-orphan", { photoId: UUID_B, variant: "full" as const, size: 20, createdAt: old }],
    ["k-young", { photoId: UUID_C, variant: "full" as const, size: 30, createdAt: young }],
  ]);

  it("lists files with no row, ignoring those young enough to be mid-upload", () => {
    const r = compareStorage({ keys, complete: true }, [{ id: UUID_A, kind: "portrait", storageKey: "k-full", thumbStorageKey: null }], NOW);
    expect(r.orphans.map((o) => o.key)).toEqual(["k-orphan"]);
    expect(r.missing).toEqual([]);
  });

  it("lists rows whose file is not in the store, only when the listing is complete", () => {
    const rows = [{ id: UUID_A, kind: "portrait", storageKey: "k-gone", thumbStorageKey: "k-full" }];
    expect(compareStorage({ keys, complete: true }, rows, NOW).missing).toEqual([{ photoId: UUID_A, kind: "portrait" }]);
    expect(compareStorage({ keys, complete: false }, rows, NOW).missing).toEqual([]);
  });

  it("a thumb key counts as known", () => {
    const r = compareStorage({ keys, complete: true }, [{ id: UUID_A, kind: "portrait", storageKey: "k-full", thumbStorageKey: "k-orphan" }], NOW);
    expect(r.orphans).toEqual([]);
  });
});

describe("listFolder", () => {
  it("follows page tokens to the end", async () => {
    const store = createMemoryPhotoStore({ pageSize: 2 });
    const folder = await store.ensureFolder("f");
    for (let i = 0; i < 5; i += 1) await store.put({ folderKey: folder, photoId: `00000000-0000-4000-8000-00000000000${i}`, variant: "full", bytes: Uint8Array.of(i), contentType: "image/jpeg" });
    const listing = await listFolder(store, folder);
    expect(listing.keys.size).toBe(5);
    expect(listing.complete).toBe(true);
  });

  it("stops at the page cap and says it is incomplete", async () => {
    const endless = { ...createMemoryPhotoStore(), list: async () => ({ items: [], next: "more" }) };
    const listing = await listFolder(endless, "f");
    expect(listing.complete).toBe(false);
    expect(CHECK_MAX_PAGES).toBeGreaterThan(0);
  });
});

describe("checkStorage", () => {
  const session = { id: UUID_A, storageFolderKey: null } as SwSession;

  async function seeded() {
    const store = createMemoryPhotoStore();
    const folder = await store.ensureFolder("s");
    const known = await store.put({ folderKey: folder, photoId: UUID_A, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" });
    await store.put({ folderKey: folder, photoId: UUID_B, variant: "full", bytes: Uint8Array.of(2), contentType: "image/jpeg" });
    st.photoRows = [
      { id: UUID_A, kind: "portrait", storageKey: known.key, thumbStorageKey: null },
      { id: UUID_C, kind: "group", storageKey: "mem-missing", thumbStorageKey: null },
    ];
    return { store, session: { ...session, storageFolderKey: folder } as SwSession };
  }

  it("reports orphan files and missing files without changing anything", async () => {
    const { store, session: s } = await seeded();
    // The memory store stamps createdAt = now, so judge "now" past the in-flight window.
    const r = await checkStorage(s, false, "u1", store, new Date(Date.now() + 2 * ORPHAN_MIN_AGE_MS));
    expect(r.orphanCount).toBe(1);
    expect(r.orphanFiles[0]).toMatchObject({ photoId: UUID_B, variant: "full" });
    expect(r.missingFiles).toEqual([{ photoId: UUID_C, kind: "group" }]);
    expect(r.deleted).toBe(0);
    expect(store.size()).toBe(2);
    expect(st.logs.at(-1)).toMatchObject({ kind: "storage_check", detail: { orphans: 1, missing: 1, complete: true } });
  });

  it("delete_orphans removes only the orphans and logs a count", async () => {
    const { store, session: s } = await seeded();
    const r = await checkStorage(s, true, "u1", store, new Date(Date.now() + 2 * ORPHAN_MIN_AGE_MS));
    expect(r.deleted).toBe(1);
    expect(store.size()).toBe(1);
    expect(st.logs.at(-1)).toMatchObject({ kind: "storage_orphans_deleted", detail: { deleted: 1 } });
  });

  it("files younger than 10 minutes are never called orphans", async () => {
    const { store, session: s } = await seeded();
    const r = await checkStorage(s, false, "u1", store, new Date());
    expect(r.orphanCount).toBe(0);
  });

  it("a session that never stored a photo has nothing to list", async () => {
    const r = await checkStorage(session, false, "u1", createMemoryPhotoStore(), NOW);
    expect(r).toMatchObject({ orphanCount: 0, missingCount: 0, complete: true });
  });
});

describe("runStorageTest", () => {
  it("pings, logs a passing test against the named session and returns the latency and mode", async () => {
    const r = await runStorageTest(UUID_A, "u1", createMemoryPhotoStore());
    expect(r).toMatchObject({ ok: true, mode: "memory" });
    expect(st.logs[0]).toMatchObject({ kind: "storage_test", detail: { ok: true } });
  });

  it("logs a failing test and rethrows the typed error", async () => {
    const store = createMemoryPhotoStore();
    store.setFailing(true);
    await expect(runStorageTest(undefined, "u1", store)).rejects.toBeInstanceOf(StorageUnavailable);
    expect(st.logs[0]).toMatchObject({ kind: "storage_test", detail: { ok: false, code: "storage_unavailable" } });
  });

  it("with no session anywhere it still tests, and logs nothing", async () => {
    st.sessions = [];
    const r = await runStorageTest(undefined, "u1", createMemoryPhotoStore());
    expect(r.ok).toBe(true);
    expect(st.logs).toHaveLength(0);
    st.sessions = [{ id: UUID_A }];
  });
});

describe("storageBannerCause", () => {
  it("is null when configured and the last test passed or never ran", () => {
    expect(storageBannerCause({ configured: true, problem: null }, null)).toBeNull();
    expect(storageBannerCause({ configured: true, problem: null }, { ok: true })).toBeNull();
  });
  it("names an unconfigured store, then a failed test", () => {
    expect(storageBannerCause({ configured: false, problem: "GOOGLE_DRIVE_SHARED_DRIVE_ID is not set" }, null)).toContain("SHARED_DRIVE_ID");
    expect(storageBannerCause({ configured: true, problem: null }, { ok: false })).toContain("failed");
  });
});
