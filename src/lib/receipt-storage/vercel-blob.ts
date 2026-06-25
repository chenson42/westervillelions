/**
 * VercelBlobStorage adapter — DECISION-020.
 *
 * Used in production when BLOB_READ_WRITE_TOKEN is set.
 *
 * @vercel/blob is imported with a dynamic `await import()` inside each method
 * so the module is never loaded in local dev (where the token is absent and
 * the package may not be installed). The factory in index.ts selects this
 * adapter only when the token is present.
 *
 * Access model (mandatory per DECISION-018 / DECISION-020):
 *   - Blobs are stored with `access: 'public'` so the Vercel CDN can serve
 *     them. However, the blob URL is NEVER returned to the browser.
 *   - `read()` fetches the bytes server-side and returns them as a Buffer.
 *   - `delete()` calls `del()` from @vercel/blob.
 *
 * The blob key is used as the pathname in the Vercel Blob store. Vercel Blob
 * prepends the store base URL automatically; the `key` passed here corresponds
 * to the `pathname` parameter of `put()`.
 */

import type { ReceiptStorage } from "./index";

export class VercelBlobStorage implements ReceiptStorage {
  async save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
    const { put } = await import("@vercel/blob");
    // Ensure we pass a proper Buffer to @vercel/blob's put() — Uint8Array is not accepted
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await put(key, buf, {
      access: "public",
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      // allowOverwrite enables idempotent re-uploads if a form is resubmitted
      allowOverwrite: true,
    });
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const { head } = await import("@vercel/blob");

    let blobUrl: string;
    try {
      // `head()` returns metadata including `url` and `contentType`
      const meta = await head(key, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      blobUrl = meta.url;
      // Fetch bytes from the CDN URL server-side — never forwards the URL to the browser
      const resp = await fetch(blobUrl);
      if (!resp.ok) return null;
      const arrayBuffer = await resp.arrayBuffer();
      return {
        bytes: Buffer.from(arrayBuffer),
        contentType: meta.contentType,
      };
    } catch {
      // BlobNotFoundError or network error — treat as not-found
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    try {
      await del(key, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch {
      // Key not found — no-op (idempotent delete)
    }
  }
}
