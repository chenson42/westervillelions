import { randomUUID } from "node:crypto";
import { StorageUnavailable } from "./errors";
import { bytesToStream, objectName, parseObjectName, type ListPage, type PhotoStore, type PutInput } from "./types";

interface Entry {
  folderKey: string;
  name: string;
  bytes: Uint8Array;
  contentType: string;
  createdAt: Date;
}

/** In-memory adapter: the test default and the contract-suite reference. */
export function createMemoryPhotoStore(options: { pageSize?: number } = {}): PhotoStore & {
  /** Test hook: make every call fail like an outage. */
  setFailing(failing: boolean): void;
  size(): number;
} {
  const pageSize = options.pageSize ?? 100;
  const folders = new Map<string, string>(); // name -> folderKey
  const objects = new Map<string, Entry>(); // key -> entry
  let failing = false;

  const guard = () => {
    if (failing) throw new StorageUnavailable();
  };

  return {
    setFailing(f) {
      failing = f;
    },
    size: () => objects.size,
    async ensureFolder(name) {
      guard();
      const existing = folders.get(name);
      if (existing) return existing;
      const key = `mem-folder-${randomUUID()}`;
      folders.set(name, key);
      return key;
    },
    async put(input: PutInput) {
      guard();
      const name = objectName(input.photoId, input.variant);
      for (const [key, e] of objects) {
        if (e.folderKey === input.folderKey && e.name === name) return { key };
      }
      const key = `mem-${randomUUID()}`;
      objects.set(key, {
        folderKey: input.folderKey,
        name,
        bytes: Uint8Array.from(input.bytes),
        contentType: input.contentType,
        createdAt: new Date(),
      });
      return { key };
    },
    async get(key) {
      guard();
      const e = objects.get(key);
      if (!e) return null;
      return { stream: bytesToStream(e.bytes), contentType: e.contentType, size: e.bytes.byteLength };
    },
    async delete(key) {
      guard();
      objects.delete(key);
    },
    async list(folderKey, pageToken) {
      guard();
      const all = [...objects.entries()].filter(([, e]) => e.folderKey === folderKey);
      const start = pageToken ? Number(pageToken) || 0 : 0;
      const slice = all.slice(start, start + pageSize);
      const page: ListPage = {
        items: slice.flatMap(([key, e]) => {
          const parsed = parseObjectName(e.name);
          return parsed ? [{ key, photoId: parsed.photoId, variant: parsed.variant, size: e.bytes.byteLength, createdAt: e.createdAt }] : [];
        }),
      };
      if (start + pageSize < all.length) page.next = String(start + pageSize);
      return page;
    },
    async ping() {
      guard();
      const started = Date.now();
      const folder = await this.ensureFolder("ping");
      const photoId = randomUUID();
      const { key } = await this.put({ folderKey: folder, photoId, variant: "thumb", bytes: Uint8Array.of(1), contentType: "application/octet-stream" });
      const back = await this.get(key);
      await this.delete(key);
      if (!back) throw new StorageUnavailable();
      return { ok: true as const, latencyMs: Date.now() - started };
    },
  };
}
