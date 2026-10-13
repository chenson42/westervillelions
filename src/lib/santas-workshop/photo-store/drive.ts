import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { processEnv, readDriveConfig, type DriveConfig } from "./config";
import { StorageFull, StorageMisconfigured, StorageRateLimited, StorageUnavailable, isStorageError, type StorageError } from "./errors";
import { objectName, parseObjectName, type ListPage, type PhotoStore, type PutInput } from "./types";

/**
 * Google Drive adapter (DECISION-122): a service account that is a member of ONE
 * private shared drive. Every call passes supportsAllDrives; listing uses the
 * shared drive corpus. No permissions.* calls and no webViewLink/webContentLink
 * anywhere: the bytes leave only through the photo-access module (scan-tested).
 *
 * The Drive client is injected as a minimal structural type, so unit tests run
 * against a fake and no test ever calls Drive. Thrown messages are fixed strings
 * from errors.ts: never the Drive message, a file id or key material.
 */

export interface DriveFileLike {
  id?: string | null;
  name?: string | null;
  size?: string | null;
  createdTime?: string | null;
  appProperties?: Record<string, string> | null;
}

export interface DriveFilesApi {
  create(params: Record<string, unknown>): Promise<{ data: { id?: string | null } }>;
  get(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ data: unknown; headers?: Record<string, unknown> }>;
  list(params: Record<string, unknown>): Promise<{ data: { files?: DriveFileLike[]; nextPageToken?: string | null } }>;
  delete(params: Record<string, unknown>): Promise<unknown>;
}

export interface DriveClientLike {
  files: DriveFilesApi;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const LIST_PAGE_SIZE = 200;

interface DriveErrorShape {
  code?: number | string;
  status?: number;
  message?: string;
  errors?: { reason?: string }[];
  response?: { status?: number; data?: { error?: unknown } };
}

function statusOf(e: unknown): number | null {
  const err = e as DriveErrorShape | null;
  const candidates = [err?.response?.status, err?.status, typeof err?.code === "number" ? err.code : Number(err?.code)];
  for (const c of candidates) if (typeof c === "number" && Number.isFinite(c) && c >= 100) return c;
  return null;
}

function reasonOf(e: unknown): string {
  const err = e as DriveErrorShape | null;
  const nested = (err?.response?.data?.error as { errors?: { reason?: string }[] } | undefined)?.errors?.[0]?.reason;
  return (err?.errors?.[0]?.reason ?? nested ?? "").toString();
}

export function isNotFoundError(e: unknown): boolean {
  return statusOf(e) === 404;
}

/** Maps any Drive/gaxios failure to a typed StorageError. Never forwards the original message. */
export function classifyDriveError(e: unknown): StorageError {
  if (isStorageError(e)) return e;
  const err = e as DriveErrorShape | null;
  const status = statusOf(e);
  const reason = reasonOf(e);
  const text = `${err?.message ?? ""} ${typeof err?.response?.data?.error === "string" ? err.response.data.error : ""}`.toLowerCase();

  if (text.includes("invalid_grant") || text.includes("invalid_client") || reason === "authError") return new StorageMisconfigured("Drive rejected the service account");
  if (reason === "storageQuotaExceeded" || reason === "quotaExceeded" || reason === "teamDriveFull" || reason === "driveStorageLimitExceeded") return new StorageFull();
  if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || reason === "sharingRateLimitExceeded") return new StorageRateLimited();
  if (status === 401 || status === 403) return new StorageMisconfigured("Drive refused access for the service account");
  if (status === 404) return new StorageMisconfigured("Drive folder or shared drive was not found");
  return new StorageUnavailable();
}

function retryable(e: unknown): boolean {
  if (isStorageError(e)) return e.retryable;
  const status = statusOf(e);
  if (status === null) return true; // network error, timeout
  return status === 429 || status >= 500;
}

function qEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface DriveStoreOptions {
  drive: DriveClientLike;
  sharedDriveId: string;
  rootFolderId: string;
  /** Backoff sleep; tests pass an immediate one. */
  sleep?: (ms: number) => Promise<void>;
}

export function createDrivePhotoStore(options: DriveStoreOptions): PhotoStore {
  const { drive, sharedDriveId, rootFolderId } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const listScope = { corpora: "drive", driveId: sharedDriveId, includeItemsFromAllDrives: true, supportsAllDrives: true } as const;

  /** One internal retry with jittered backoff on 5xx, 429 and network errors, then the typed error. */
  async function call<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (first) {
      if (isNotFoundError(first)) throw first;
      if (!retryable(first)) throw classifyDriveError(first);
      await sleep(200 + Math.floor(Math.random() * 300));
      try {
        return await op();
      } catch (second) {
        if (isNotFoundError(second)) throw second;
        throw classifyDriveError(second);
      }
    }
  }

  async function findByAppProperties(folderKey: string, photoId: string, variant: string): Promise<string | null> {
    const res = await call(() =>
      drive.files.list({
        ...listScope,
        q: `'${qEscape(folderKey)}' in parents and trashed = false and appProperties has { key='photo_id' and value='${qEscape(photoId)}' } and appProperties has { key='variant' and value='${qEscape(variant)}' }`,
        fields: "files(id)",
        pageSize: 2,
      }),
    );
    return res.data.files?.[0]?.id ?? null;
  }

  const store: PhotoStore = {
    async ensureFolder(name) {
      const found = await call(() =>
        drive.files.list({
          ...listScope,
          q: `name = '${qEscape(name)}' and mimeType = '${FOLDER_MIME}' and '${qEscape(rootFolderId)}' in parents and trashed = false`,
          fields: "files(id)",
          pageSize: 1,
        }),
      );
      const existing = found.data.files?.[0]?.id;
      if (existing) return existing;
      const created = await call(() =>
        drive.files.create({
          requestBody: { name, mimeType: FOLDER_MIME, parents: [rootFolderId] },
          fields: "id",
          supportsAllDrives: true,
        }),
      );
      if (!created.data.id) throw new StorageUnavailable();
      return created.data.id;
    },

    async put(input: PutInput) {
      if ((input.attempt ?? 1) > 1) {
        // The first request may have reached Drive and lost its reply: never create a second file.
        const existing = await findByAppProperties(input.folderKey, input.photoId, input.variant);
        if (existing) return { key: existing };
      }
      const created = await call(() =>
        drive.files.create({
          requestBody: {
            name: `${objectName(input.photoId, input.variant)}.jpg`,
            parents: [input.folderKey],
            appProperties: { photo_id: input.photoId, variant: input.variant },
          },
          media: { mimeType: input.contentType, body: Readable.from(Buffer.from(input.bytes)) },
          fields: "id",
          supportsAllDrives: true,
        }),
      );
      if (!created.data.id) throw new StorageUnavailable();
      return { key: created.data.id };
    },

    async get(key) {
      try {
        const res = await call(() => drive.files.get({ fileId: key, alt: "media", supportsAllDrives: true }, { responseType: "stream" }));
        const headers = res.headers ?? {};
        const length = Number(headers["content-length"]);
        const stream = Readable.toWeb(res.data as Readable) as unknown as ReadableStream<Uint8Array>;
        return {
          stream,
          contentType: typeof headers["content-type"] === "string" ? (headers["content-type"] as string) : "image/jpeg",
          size: Number.isFinite(length) && length > 0 ? length : null,
        };
      } catch (e) {
        if (isNotFoundError(e)) return null;
        throw e;
      }
    },

    async delete(key) {
      try {
        // Permanent delete (not trash): the purge promise is "we will take it down".
        await call(() => drive.files.delete({ fileId: key, supportsAllDrives: true }));
      } catch (e) {
        if (isNotFoundError(e)) return;
        throw e;
      }
    },

    async list(folderKey, pageToken) {
      const res = await call(() =>
        drive.files.list({
          ...listScope,
          q: `'${qEscape(folderKey)}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, size, createdTime, appProperties)",
          pageSize: LIST_PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      const items: ListPage["items"] = [];
      for (const f of res.data.files ?? []) {
        if (!f.id) continue;
        const fromName = f.name ? parseObjectName(f.name) : null;
        const photoId = f.appProperties?.photo_id ?? fromName?.photoId;
        const variant = (f.appProperties?.variant ?? fromName?.variant) as "full" | "thumb" | undefined;
        if (!photoId || (variant !== "full" && variant !== "thumb")) continue;
        items.push({ key: f.id, photoId, variant, size: Number(f.size ?? 0) || 0, createdAt: f.createdTime ? new Date(f.createdTime) : null });
      }
      return { items, ...(res.data.nextPageToken ? { next: res.data.nextPageToken } : {}) };
    },

    async ping() {
      const started = Date.now();
      const { key } = await store.put({
        folderKey: rootFolderId,
        photoId: randomUUID(),
        variant: "thumb",
        bytes: Uint8Array.of(1, 2, 3),
        contentType: "application/octet-stream",
      });
      try {
        const back = await store.get(key);
        if (!back) throw new StorageUnavailable();
        await back.stream.cancel().catch(() => undefined);
      } finally {
        await store.delete(key).catch(() => undefined);
      }
      return { ok: true as const, latencyMs: Date.now() - started };
    },
  };
  return store;
}

/** Builds the real Drive client. `googleapis` loads lazily so only photo routes pay its cold start. */
export async function createDriveClient(config: DriveConfig): Promise<DriveClientLike> {
  const { google } = await import("googleapis");
  const auth = new google.auth.JWT({
    email: config.account.clientEmail,
    key: config.account.privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth }) as unknown as DriveClientLike;
}

/** A PhotoStore whose Drive client is created on first use (reading config then, so a missing key is a typed error at call time). */
export function createLazyDrivePhotoStore(env: NodeJS.ProcessEnv = processEnv()): PhotoStore {
  let inner: Promise<PhotoStore> | null = null;
  const get = (): Promise<PhotoStore> => {
    if (!inner) {
      inner = (async () => {
        const config = readDriveConfig(env);
        const drive = await createDriveClient(config);
        return createDrivePhotoStore({ drive, sharedDriveId: config.sharedDriveId, rootFolderId: config.rootFolderId });
      })();
      inner.catch(() => {
        inner = null; // let the next call retry (config may have been fixed)
      });
    }
    return inner;
  };
  return {
    ensureFolder: async (n) => (await get()).ensureFolder(n),
    put: async (i) => (await get()).put(i),
    get: async (k) => (await get()).get(k),
    delete: async (k) => (await get()).delete(k),
    list: async (f, p) => (await get()).list(f, p),
    ping: async () => (await get()).ping(),
  };
}

