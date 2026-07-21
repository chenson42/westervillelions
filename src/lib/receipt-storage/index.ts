/**
 * Pluggable receipt storage interface — DECISION-020.
 *
 * `getReceiptStorage()` selects the adapter at runtime based on the presence
 * of the BLOB_READ_WRITE_TOKEN environment variable:
 *
 *   - BLOB_READ_WRITE_TOKEN set → VercelBlobStorage (production)
 *   - BLOB_READ_WRITE_TOKEN absent → LocalReceiptStorage (local dev / test)
 *
 * The interface stores an opaque `key` (pattern: receipts/<uuid>/<filename>).
 * The key is never a URL — the underlying storage location is never returned
 * to the browser. Receipt reads always go through a server-side proxy route
 * that calls `read()` and streams the bytes.
 */

import type { LocalReceiptStorage } from "./local";
import type { VercelBlobStorage } from "./vercel-blob";

// ---------------------------------------------------------------------------
// Shared key format
// ---------------------------------------------------------------------------

/**
 * Canonical format for an opaque receipt storage key: `receipts/<uuid>/<name>`.
 *
 * Single shared export — DECISION-035 hoisted this out of the reimbursement
 * upload routes (where it was duplicated verbatim) so the Transaction Receipt
 * Upload feature could reuse it instead of pasting a third copy. Every route
 * that accepts a client-supplied `receiptStorageKey` must validate against
 * this before writing it to the database.
 */
export const RECEIPT_KEY_REGEX = /^receipts\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,150}$/;

// ---------------------------------------------------------------------------
// Bytes -> Response BodyInit conversion
// ---------------------------------------------------------------------------

/**
 * Convert stored receipt bytes into a value safe to pass as a Fetch
 * `Response` body.
 *
 * Regression guard (QA Phase 5, 2026-07-21): `Buffer.prototype.buffer` is the
 * Buffer's *underlying* ArrayBuffer, not a slice scoped to the view's own
 * `[byteOffset, byteOffset + byteLength)`. Node pools small allocations
 * (`fs.readFileSync` on a file under `Buffer.poolSize`, default 8KB, returns a
 * Buffer that is a *view* into a much larger shared pool ArrayBuffer with a
 * nonzero `byteOffset`). Both receipt-view routes previously did
 * `new Response(stored.bytes.buffer as ArrayBuffer, ...)`, which ignores
 * `byteOffset`/`byteLength` entirely and streams the wrong region of memory
 * (observed: an unrelated SQL string fragment) while still declaring the
 * correct `Content-Length` for the real file — corrupting the response body
 * and, in one reproduction, the keep-alive connection.
 *
 * Always convert through this helper before constructing a `Response` from
 * stored receipt bytes — never read `.buffer` off a `Buffer`/`Uint8Array`
 * directly.
 *
 * Implementation note: `Uint8Array.from(typedArray)` copies exactly
 * `typedArray`'s own elements (respecting its `byteOffset`/`byteLength`,
 * never the backing buffer's full extent) into a freshly allocated,
 * exactly-sized plain `ArrayBuffer`. That makes it immune to the pooling bug
 * by construction — and unlike `new Uint8Array(buf, offset, length)` against
 * a Node `Buffer`'s `.buffer` (typed `ArrayBufferLike`, not assignable to
 * `BodyInit` under this project's TS lib version), the return type here is a
 * concrete `Uint8Array<ArrayBuffer>`.
 */
export function receiptBytesToBodyInit(bytes: Buffer | Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// ReceiptStorage interface
// ---------------------------------------------------------------------------

export interface ReceiptStorage {
  /**
   * Persist file bytes under the given opaque key.
   *
   * @param key          Storage key, e.g. `receipts/<uuid>/<sanitized-name>`
   * @param bytes        File bytes
   * @param contentType  MIME type (e.g. `application/pdf`, `image/jpeg`)
   */
  save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void>;

  /**
   * Retrieve previously stored bytes.
   * Returns `null` if the key does not exist (caller should 404).
   */
  read(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;

  /**
   * Delete stored bytes. No-ops silently if the key does not exist.
   */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _instance: ReceiptStorage | null = null;

/**
 * Returns the singleton `ReceiptStorage` adapter for the current environment.
 *
 * Adapter selection:
 *   - `BLOB_READ_WRITE_TOKEN` present → `VercelBlobStorage` (never imported in local dev)
 *   - absent → `LocalReceiptStorage` (writes to `.receipt-store/` in repo root)
 *
 * The instance is cached for the lifetime of the process. Call is synchronous
 * so callers do not need to await the factory.
 */
export function getReceiptStorage(): ReceiptStorage {
  if (_instance) return _instance;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Lazy synchronous require — avoids loading @vercel/blob in local dev.
    // The dynamic require is intentional: the module is only present in
    // production / CI where the Vercel runtime has installed it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VercelBlobStorage: VBS } = require("./vercel-blob") as {
      VercelBlobStorage: new () => VercelBlobStorage;
    };
    _instance = new VBS();
  } else {
    // FU-6: Warn in production when BLOB_READ_WRITE_TOKEN is absent.
    // LocalReceiptStorage writes to the function's ephemeral filesystem, which
    // is destroyed on every cold start and redeployment. Without the token, all
    // uploaded receipts will be permanently lost after the next deploy.
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[receipt-storage] BLOB_READ_WRITE_TOKEN is not set in production. " +
          "Falling back to LocalReceiptStorage — receipt files will be lost on redeployment. " +
          "Set BLOB_READ_WRITE_TOKEN in your Vercel environment variables.",
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalReceiptStorage: LRS } = require("./local") as {
      LocalReceiptStorage: new () => LocalReceiptStorage;
    };
    _instance = new LRS();
  }

  return _instance;
}

/**
 * Reset the cached adapter instance (test helper only — not for production use).
 */
export function _resetReceiptStorageForTest(): void {
  _instance = null;
}
