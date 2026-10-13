import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createDrivePhotoStore, classifyDriveError, type DriveClientLike } from "./drive";
import { parseServiceAccountJson, readDriveConfig, selectPhotoStoreMode } from "./config";
import { StorageFull, StorageMisconfigured, StorageRateLimited, StorageUnavailable } from "./errors";
import { getPhotoStore, resetPhotoStoreForTests } from "./index";
import { createLocalPhotoStore } from "./local";
import { createMemoryPhotoStore } from "./memory";
import { streamToBytes } from "./types";

const PHOTO_ID = "11111111-1111-4111-8111-111111111111";

type Call = { op: string; params: Record<string, unknown>; options?: Record<string, unknown> };

function fakeDrive(handlers: Partial<Record<"create" | "get" | "list" | "delete", (params: Record<string, unknown>, n: number) => unknown>> = {}) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const run = async (op: "create" | "get" | "list" | "delete", params: Record<string, unknown>, options?: Record<string, unknown>) => {
    calls.push({ op, params, options });
    counts[op] = (counts[op] ?? 0) + 1;
    const h = handlers[op];
    if (!h) throw new Error(`unexpected ${op}`);
    const out = h(params, counts[op]);
    if (out instanceof Error) throw out;
    return out;
  };
  const client: DriveClientLike = {
    files: {
      create: (p) => run("create", p) as never,
      get: (p, o) => run("get", p, o) as never,
      list: (p) => run("list", p) as never,
      delete: (p) => run("delete", p) as never,
    },
  };
  return { client, calls };
}

const httpError = (status: number, reason = "") => Object.assign(new Error("drive said no (private_key must never leak)"), { code: status, errors: [{ reason }] });
const store = (client: DriveClientLike) => createDrivePhotoStore({ drive: client, sharedDriveId: "drive-1", rootFolderId: "root-1", sleep: async () => undefined });

describe("Drive adapter over a fake client", () => {
  it("put sends supportsAllDrives, the parent, appProperties.photo_id and a media body", async () => {
    const { client, calls } = fakeDrive({ create: () => ({ data: { id: "file-1" } }) });
    const r = await store(client).put({ folderKey: "folder-1", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1, 2, 3), contentType: "image/jpeg" });
    expect(r).toEqual({ key: "file-1" });
    expect(calls).toHaveLength(1);
    const p = calls[0].params as { supportsAllDrives: boolean; requestBody: { parents: string[]; appProperties: Record<string, string>; name: string }; media: { mimeType: string; body: unknown } };
    expect(p.supportsAllDrives).toBe(true);
    expect(p.requestBody.parents).toEqual(["folder-1"]);
    expect(p.requestBody.appProperties).toEqual({ photo_id: PHOTO_ID, variant: "full" });
    expect(p.requestBody.name).toBe(`${PHOTO_ID}-full.jpg`);
    expect(p.media.mimeType).toBe("image/jpeg");
    expect(p.media.body).toBeInstanceOf(Readable);
  });

  it("the first attempt creates directly, with no lookup call", async () => {
    const { client, calls } = fakeDrive({ create: () => ({ data: { id: "f" } }) });
    await store(client).put({ folderKey: "f1", photoId: PHOTO_ID, variant: "thumb", bytes: Uint8Array.of(1), contentType: "image/jpeg", attempt: 1 });
    expect(calls.map((c) => c.op)).toEqual(["create"]);
  });

  it("attempt > 1 looks up by appProperties first and returns the existing key without creating", async () => {
    const { client, calls } = fakeDrive({ list: () => ({ data: { files: [{ id: "existing" }] } }), create: () => ({ data: { id: "new" } }) });
    const r = await store(client).put({ folderKey: "folder-1", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg", attempt: 2 });
    expect(r).toEqual({ key: "existing" });
    expect(calls.map((c) => c.op)).toEqual(["list"]);
    expect(String(calls[0].params.q)).toContain(`key='photo_id' and value='${PHOTO_ID}'`);
  });

  it("attempt > 1 with nothing found creates", async () => {
    const { client, calls } = fakeDrive({ list: () => ({ data: { files: [] } }), create: () => ({ data: { id: "new" } }) });
    const r = await store(client).put({ folderKey: "folder-1", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg", attempt: 3 });
    expect(r).toEqual({ key: "new" });
    expect(calls.map((c) => c.op)).toEqual(["list", "create"]);
  });

  it("get streams the media; a 404 returns null", async () => {
    const ok = fakeDrive({ get: () => ({ data: Readable.from([Buffer.from([7, 8, 9])]), headers: { "content-type": "image/jpeg", "content-length": "3" } }) });
    const got = await store(ok.client).get("file-1");
    expect(got?.size).toBe(3);
    expect(Array.from(await streamToBytes(got!.stream))).toEqual([7, 8, 9]);
    expect(ok.calls[0].params).toMatchObject({ fileId: "file-1", alt: "media", supportsAllDrives: true });
    expect(ok.calls[0].options).toEqual({ responseType: "stream" });

    const missing = fakeDrive({ get: () => httpError(404) });
    expect(await store(missing.client).get("gone")).toBeNull();
    expect(missing.calls).toHaveLength(1); // a 404 is not retried
  });

  it("delete is permanent and a 404 is success", async () => {
    const ok = fakeDrive({ delete: () => ({}) });
    await store(ok.client).delete("file-1");
    expect(ok.calls[0].params).toMatchObject({ fileId: "file-1", supportsAllDrives: true });
    const missing = fakeDrive({ delete: () => httpError(404) });
    await expect(store(missing.client).delete("gone")).resolves.toBeUndefined();
  });

  it("a 5xx is retried once, then StorageUnavailable", async () => {
    const flaky = fakeDrive({ create: (_p, n) => (n === 1 ? httpError(503) : { data: { id: "ok" } }) });
    expect(await store(flaky.client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" })).toEqual({ key: "ok" });
    expect(flaky.calls).toHaveLength(2);

    const down = fakeDrive({ create: () => httpError(500) });
    await expect(store(down.client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" })).rejects.toBeInstanceOf(StorageUnavailable);
    expect(down.calls).toHaveLength(2);
  });

  it("a retried upload sends a fresh body each time (a consumed stream would upload nothing)", async () => {
    const bodies: unknown[] = [];
    const { client } = fakeDrive({
      create: (p, n) => {
        bodies.push((p.media as { body: unknown }).body);
        return n === 1 ? httpError(502) : { data: { id: "ok" } };
      },
    });
    await store(client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).not.toBe(bodies[1]);
  });

  it("invalid_grant is StorageMisconfigured, quota is StorageFull, 429 is StorageRateLimited", async () => {
    const grant = fakeDrive({ create: () => Object.assign(new Error("invalid_grant: Invalid JWT Signature"), { code: 400 }) });
    await expect(store(grant.client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" })).rejects.toBeInstanceOf(StorageMisconfigured);
    expect(grant.calls).toHaveLength(1); // not retryable

    const full = fakeDrive({ create: () => httpError(403, "storageQuotaExceeded") });
    await expect(store(full.client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" })).rejects.toBeInstanceOf(StorageFull);

    const limited = fakeDrive({ create: () => httpError(429) });
    await expect(store(limited.client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" })).rejects.toBeInstanceOf(StorageRateLimited);
  });

  it("no thrown message contains key material, the Drive message or a file id", async () => {
    const leaky = fakeDrive({ create: () => Object.assign(new Error("-----BEGIN PRIVATE KEY----- private_key secret"), { code: 500 }) });
    try {
      await store(leaky.client).put({ folderKey: "f", photoId: PHOTO_ID, variant: "full", bytes: Uint8Array.of(1), contentType: "image/jpeg" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toMatch(/private_key|PRIVATE KEY|secret/);
    }
    expect(classifyDriveError(new Error("private_key leak")).message).not.toContain("private_key");
  });

  it("listing uses the shared drive corpus and parses names", async () => {
    const { client, calls } = fakeDrive({
      list: () => ({
        data: {
          files: [
            { id: "a", name: `${PHOTO_ID}-full.jpg`, size: "10", createdTime: "2026-12-18T10:00:00Z", appProperties: { photo_id: PHOTO_ID, variant: "full" } },
            { id: "b", name: "stray.txt" },
          ],
          nextPageToken: "tok",
        },
      }),
    });
    const page = await store(client).list("folder-1");
    expect(page.items).toEqual([{ key: "a", photoId: PHOTO_ID, variant: "full", size: 10, createdAt: new Date("2026-12-18T10:00:00Z") }]);
    expect(page.next).toBe("tok");
    expect(calls[0].params).toMatchObject({ corpora: "drive", driveId: "drive-1", includeItemsFromAllDrives: true, supportsAllDrives: true });
  });

  it("ensureFolder finds an existing folder or creates one under the root", async () => {
    const found = fakeDrive({ list: () => ({ data: { files: [{ id: "folder-9" }] } }) });
    expect(await store(found.client).ensureFolder("session-a")).toBe("folder-9");
    const created = fakeDrive({ list: () => ({ data: { files: [] } }), create: () => ({ data: { id: "folder-new" } }) });
    expect(await store(created.client).ensureFolder("session-a")).toBe("folder-new");
    expect((created.calls[1].params as { requestBody: { parents: string[] } }).requestBody.parents).toEqual(["root-1"]);
  });

  it("ping writes, reads back and deletes", async () => {
    const { client, calls } = fakeDrive({
      create: () => ({ data: { id: "ping-1" } }),
      get: () => ({ data: Readable.from([Buffer.from([1])]), headers: {} }),
      delete: () => ({}),
    });
    const r = await store(client).ping();
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.op)).toEqual(["create", "get", "delete"]);
  });
});

describe("Drive config", () => {
  const key = JSON.stringify({ client_email: "sa@example.invalid", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" });

  it("accepts the minified one-line JSON", () => {
    expect(parseServiceAccountJson(key)).toMatchObject({ clientEmail: "sa@example.invalid" });
    expect(readDriveConfig({ GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: key, GOOGLE_DRIVE_SHARED_DRIVE_ID: "d1" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ sharedDriveId: "d1", rootFolderId: "d1" });
  });

  it("rejects a missing client_email, bad JSON and an empty value without echoing them", () => {
    expect(() => parseServiceAccountJson(JSON.stringify({ private_key: "PRIVATE KEY" }))).toThrow(StorageMisconfigured);
    expect(() => parseServiceAccountJson("{not json private_key")).toThrow(/not valid JSON/);
    try {
      parseServiceAccountJson("{not json private_key");
    } catch (e) {
      expect((e as Error).message).not.toContain("private_key");
    }
    expect(() => parseServiceAccountJson(undefined)).toThrow(StorageMisconfigured);
    expect(() => readDriveConfig({ GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: key } as unknown as NodeJS.ProcessEnv)).toThrow(/SHARED_DRIVE_ID/);
  });
});

describe("photo store factory", () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
  const driveEnv = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "sa@example.invalid", private_key: "PRIVATE KEY" }),
    GOOGLE_DRIVE_SHARED_DRIVE_ID: "d1",
  };

  it("NODE_ENV=test selects memory", () => {
    expect(selectPhotoStoreMode(env({ NODE_ENV: "test" }))).toBe("memory");
    resetPhotoStoreForTests();
    expect(getPhotoStore(env({ NODE_ENV: "test" }))).toBeDefined();
  });

  it("production with no config throws and never returns local or memory", () => {
    expect(selectPhotoStoreMode(env({ NODE_ENV: "production" }))).toBe("drive");
    expect(() => getPhotoStore(env({ NODE_ENV: "production" }))).toThrow(StorageMisconfigured);
    expect(() => getPhotoStore(env({ NODE_ENV: "production", SW_PHOTO_STORE: "local" }))).toThrow(StorageMisconfigured);
  });

  it("production with config returns a Drive-backed store", () => {
    expect(getPhotoStore(env({ NODE_ENV: "production", ...driveEnv }))).toBeDefined();
  });

  it("development defaults to local even when Drive credentials are present (opt-in only)", () => {
    expect(selectPhotoStoreMode(env({ NODE_ENV: "development", ...driveEnv }))).toBe("local");
    expect(selectPhotoStoreMode(env({ NODE_ENV: "development" }))).toBe("local");
  });

  it("development with SW_PHOTO_STORE=drive selects Drive, and fails closed without config", () => {
    expect(selectPhotoStoreMode(env({ NODE_ENV: "development", SW_PHOTO_STORE: "drive" }))).toBe("drive");
    expect(() => getPhotoStore(env({ NODE_ENV: "development", SW_PHOTO_STORE: "drive" }))).toThrow(StorageMisconfigured);
    expect(getPhotoStore(env({ NODE_ENV: "development", SW_PHOTO_STORE: "drive", ...driveEnv }))).toBeDefined();
  });

  it("the memory and local adapters are independent implementations of the interface", () => {
    expect(createMemoryPhotoStore()).not.toBe(createMemoryPhotoStore());
    expect(typeof createLocalPhotoStore(".x").ping).toBe("function");
  });
});
