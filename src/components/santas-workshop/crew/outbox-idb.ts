/**
 * IndexedDB storage for the photo outbox (browser only). One database per
 * session slug so two events on one phone never mix. Blobs are stored as
 * Blobs. If IndexedDB is unavailable (some private modes) `openOutboxStorage`
 * returns a memory store flagged `durable: false`, and the UI says plainly that
 * the photos will be lost if the page is closed.
 */

import { createMemoryStorage, type OutboxItem, type OutboxStorage } from "./outbox-core";

const STORE = "photos";

export interface OpenedStorage {
  storage: OutboxStorage;
  durable: boolean;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "photoId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

export async function openOutboxStorage(slug: string): Promise<OpenedStorage> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
    const db = await open(`sw-crew-outbox-${slug}`);
    // A write resolves only when its transaction COMMITS: the outbox's promise to the worker
    // ("Saved on this phone") is made on that signal, not on the request succeeding.
    const write = (fn: (store: IDBObjectStore) => void) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        fn(t.objectStore(STORE));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    const storage: OutboxStorage = {
      put: (item: OutboxItem) => write((s) => void s.put(item)),
      async getAll() {
        return (await request(db.transaction(STORE, "readonly").objectStore(STORE).getAll())) as OutboxItem[];
      },
      remove: (photoId: string) => write((s) => void s.delete(photoId)),
    };
    return { storage, durable: true };
  } catch {
    return { storage: createMemoryStorage(), durable: false };
  }
}
