/**
 * Pluggable Club Files storage interface — DECISION-094.
 *
 * Sibling of src/lib/receipt-storage/ (same three-method interface, same
 * NODE_ENV-gated adapter selection per DECISION-040), backed by its own
 * table (`club_file_blobs`) rather than reusing `ledger_receipt_files` —
 * Club Files is a categorically different feature (general admin-authored
 * PDF library, not Ledger receipts) and Phase 2's review explicitly ruled
 * against reuse. See docs/work-log/2026-09-04-club-documents.md Phase 2/3.
 *
 * `getClubFileStorage()` selects the adapter at runtime based on NODE_ENV:
 *
 *   - NODE_ENV === "production" → DatabaseClubFileStorage (Postgres, club_file_blobs)
 *   - otherwise (development, test) → LocalClubFileStorage (.club-file-store/)
 *
 * No environment variable controls this selection, matching the receipt
 * storage adapter's rationale exactly (NODE_ENV is platform-set, not
 * admin-configured).
 *
 * The interface stores an opaque `key` (pattern: club-files/<uuid>/<filename>).
 * The key is never a URL and is never returned to the browser — reads
 * always go through the server-side download route
 * (GET /api/club-files/[id]/download), which streams the bytes.
 */

import type { LocalClubFileStorage } from "./local";
import type { DatabaseClubFileStorage } from "./database";

// ---------------------------------------------------------------------------
// Shared key format
// ---------------------------------------------------------------------------

/**
 * Canonical format for an opaque Club Files storage key:
 * `club-files/<uuid>/<name>` — mirrors RECEIPT_KEY_REGEX's shape exactly.
 */
export const CLUB_FILE_KEY_REGEX = /^club-files\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]{1,150}$/;

/**
 * Sanitize a user-supplied filename to safe characters only, truncated to
 * 150 chars. Shared by the finalize route (building the storage key) and
 * the download route (re-sanitizing before it's echoed into
 * Content-Disposition — never trust the stored value alone, per Phase 1's
 * adversarial-pass requirement).
 */
export function sanitizeClubFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "_") // no leading dots
    .slice(0, 150);
}

// ---------------------------------------------------------------------------
// ClubFileStorage interface
// ---------------------------------------------------------------------------

export interface ClubFileStorage {
  /**
   * Persist file bytes under the given opaque key.
   *
   * @param key          Storage key, e.g. `club-files/<uuid>/<sanitized-name>`
   * @param bytes        File bytes
   * @param contentType  MIME type (always `application/pdf` in v1)
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

let _instance: ClubFileStorage | null = null;

/**
 * Returns the singleton `ClubFileStorage` adapter for the current environment.
 *
 * Adapter selection (mirrors DECISION-040):
 *   - `NODE_ENV === "production"` → `DatabaseClubFileStorage` (Postgres, club_file_blobs)
 *   - otherwise → `LocalClubFileStorage` (writes to `.club-file-store/` in repo root)
 *
 * The instance is cached for the lifetime of the process. Call is synchronous
 * so callers do not need to await the factory.
 */
export function getClubFileStorage(): ClubFileStorage {
  if (_instance) return _instance;

  if (process.env.NODE_ENV === "production") {
    // Lazy synchronous require — avoids loading @/lib/db (and opening a DB
    // connection) in local dev / test, where NODE_ENV !== "production" and
    // this branch never runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseClubFileStorage: DCFS } = require("./database") as {
      DatabaseClubFileStorage: new () => DatabaseClubFileStorage;
    };
    _instance = new DCFS();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalClubFileStorage: LCFS } = require("./local") as {
      LocalClubFileStorage: new () => LocalClubFileStorage;
    };
    _instance = new LCFS();
  }

  return _instance;
}

/**
 * Reset the cached adapter instance (test helper only — not for production use).
 */
export function _resetClubFileStorageForTest(): void {
  _instance = null;
}
