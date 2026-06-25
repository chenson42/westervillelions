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
