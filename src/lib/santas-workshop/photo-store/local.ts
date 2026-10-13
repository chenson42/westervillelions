import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { StorageMisconfigured, StorageUnavailable } from "./errors";
import { objectName, parseObjectName, type ListPage, type PhotoStore, type PutInput } from "./types";

/**
 * Local-filesystem adapter: the development default, so QA and the crew UI run
 * end to end without Drive credentials. Files live under `.santas-workshop-store/`
 * (gitignored). Keys are `<folder>/<photoId>-<variant>`; every segment must match
 * a strict pattern, which is what rejects path traversal.
 *
 * The root is a runtime value (dev only), so every path is marked
 * `turbopackIgnore`: otherwise Turbopack treats the dynamic filesystem access as a
 * reason to trace the whole project (~1,800 files) into every route that imports the store.
 */

const SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;

function safeSegment(segment: string): string {
  if (!SEGMENT.test(segment)) throw new StorageMisconfigured("Invalid storage key");
  return segment;
}

function splitKey(key: string): { folder: string; name: string } {
  const parts = key.split("/");
  if (parts.length !== 2) throw new StorageMisconfigured("Invalid storage key");
  return { folder: safeSegment(parts[0]), name: safeSegment(parts[1]) };
}

function isNotFound(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "ENOENT";
}

export function createLocalPhotoStore(rootDir: string, options: { pageSize?: number } = {}): PhotoStore {
  const pageSize = options.pageSize ?? 100;
  const pathOf = (folder: string, name: string) => join(/*turbopackIgnore: true*/ rootDir, folder, name);

  async function wrap<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof StorageMisconfigured || e instanceof StorageUnavailable) throw e;
      throw new StorageUnavailable();
    }
  }

  const store: PhotoStore = {
    ensureFolder(name) {
      return wrap(async () => {
        const folder = safeSegment(name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session");
        await mkdir(join(/*turbopackIgnore: true*/ rootDir, folder), { recursive: true });
        return folder;
      });
    },
    put(input: PutInput) {
      return wrap(async () => {
        const folder = safeSegment(input.folderKey);
        const name = objectName(input.photoId, input.variant);
        safeSegment(name);
        await mkdir(join(/*turbopackIgnore: true*/ rootDir, folder), { recursive: true });
        await writeFile(pathOf(folder, name), input.bytes);
        await writeFile(`${pathOf(folder, name)}.meta`, input.contentType);
        return { key: `${folder}/${name}` };
      });
    },
    get(key) {
      return wrap(async () => {
        const { folder, name } = splitKey(key);
        const path = pathOf(folder, name);
        try {
          const info = await stat(path);
          const contentType = await readFile(`${path}.meta`, "utf8").catch(() => "image/jpeg");
          return {
            stream: Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>,
            contentType,
            size: info.size,
          };
        } catch (e) {
          if (isNotFound(e)) return null;
          throw e;
        }
      });
    },
    delete(key) {
      return wrap(async () => {
        const { folder, name } = splitKey(key);
        await rm(pathOf(folder, name), { force: true });
        await rm(`${pathOf(folder, name)}.meta`, { force: true });
      });
    },
    list(folderKey, pageToken) {
      return wrap(async () => {
        const folder = safeSegment(folderKey);
        let names: string[];
        try {
          names = (await readdir(join(/*turbopackIgnore: true*/ rootDir, folder))).filter((n) => !n.endsWith(".meta")).sort();
        } catch (e) {
          if (isNotFound(e)) return { items: [] } satisfies ListPage;
          throw e;
        }
        const start = pageToken ? Number(pageToken) || 0 : 0;
        const slice = names.slice(start, start + pageSize);
        const items: ListPage["items"] = [];
        for (const name of slice) {
          const parsed = parseObjectName(name);
          if (!parsed) continue;
          const info = await stat(pathOf(folder, name));
          items.push({ key: `${folder}/${name}`, photoId: parsed.photoId, variant: parsed.variant, size: info.size, createdAt: info.mtime });
        }
        const page: ListPage = { items };
        if (start + pageSize < names.length) page.next = String(start + pageSize);
        return page;
      });
    },
    async ping() {
      const started = Date.now();
      const folder = await store.ensureFolder("ping");
      const { key } = await store.put({ folderKey: folder, photoId: randomUUID(), variant: "thumb", bytes: Uint8Array.of(1), contentType: "application/octet-stream" });
      const back = await store.get(key);
      await store.delete(key);
      if (!back) throw new StorageUnavailable();
      await back.stream.cancel().catch(() => undefined);
      return { ok: true as const, latencyMs: Date.now() - started };
    },
  };
  return store;
}
