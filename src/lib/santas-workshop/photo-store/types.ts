/**
 * The PhotoStore seam (DECISION-122). Adapters: Drive (production), local
 * filesystem (development default), in-memory (tests). Keys are OPAQUE: callers
 * keep them in `sw_photos.storage_key` and never build, parse or return them.
 * Metadata-only database; the bytes live behind this interface.
 */

export type PhotoVariant = "full" | "thumb";

export interface PutInput {
  folderKey: string;
  /** The client-generated photo uuid; (folder, photoId, variant) is the idempotency key. */
  photoId: string;
  variant: PhotoVariant;
  bytes: Uint8Array;
  contentType: string;
  /** 1 for the first try. When greater than 1 the adapter looks for an existing object first. */
  attempt?: number;
}

export interface StoredObject {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  /** null when the backend did not report a length. */
  size: number | null;
}

export interface ListItem {
  key: string;
  photoId: string;
  variant: PhotoVariant;
  size: number;
  /** For "files younger than N minutes are probably in flight" in Check storage. */
  createdAt: Date | null;
}

export interface ListPage {
  items: ListItem[];
  next?: string;
}

export interface PhotoStore {
  /** Idempotent. Returns the folder key to pass to put()/list(). */
  ensureFolder(name: string): Promise<string>;
  put(input: PutInput): Promise<{ key: string }>;
  /** null = missing. */
  get(key: string): Promise<StoredObject | null>;
  /** A missing key is success. */
  delete(key: string): Promise<void>;
  list(folderKey: string, pageToken?: string): Promise<ListPage>;
  /** Writes, reads back and deletes a tiny object. */
  ping(): Promise<{ ok: true; latencyMs: number }>;
}

export const PHOTO_VARIANTS: readonly PhotoVariant[] = ["full", "thumb"];

export function isPhotoVariant(v: unknown): v is PhotoVariant {
  return v === "full" || v === "thumb";
}

/** `<photoId>-<variant>` : the opaque object name every adapter uses. */
export function objectName(photoId: string, variant: PhotoVariant): string {
  return `${photoId}-${variant}`;
}

const OBJECT_NAME = /^([0-9a-f-]{36})-(full|thumb)(?:\.jpg)?$/i;

export function parseObjectName(name: string): { photoId: string; variant: PhotoVariant } | null {
  const m = OBJECT_NAME.exec(name);
  return m ? { photoId: m[1].toLowerCase(), variant: m[2].toLowerCase() as PhotoVariant } : null;
}

export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

export async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
