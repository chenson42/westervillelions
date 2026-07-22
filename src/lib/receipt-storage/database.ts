/**
 * DatabaseReceiptStorage adapter — DECISION-040.
 *
 * Used in production (NODE_ENV === "production"). Bytes live in the
 * `ledger_receipt_files` table, keyed by the same opaque
 * `receipts/<uuid>/<name>` key format as the other two adapters (DECISION-020).
 *
 * `save()` is an upsert (`INSERT ... ON CONFLICT (key) DO UPDATE`), matching
 * `VercelBlobStorage`'s `allowOverwrite: true` and `LocalReceiptStorage`'s
 * unconditional `writeFileSync` — a re-upload under the same key must not
 * throw. `created_at` is deliberately NOT included in the `DO UPDATE SET`
 * list: first-write-wins for the timestamp (architect Suggestion, Phase 2).
 */

import { db } from "@/lib/db";
import { ledgerReceiptFiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ReceiptStorage } from "./index";

export class DatabaseReceiptStorage implements ReceiptStorage {
  async save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
    // Ensure we pass a proper Buffer to the bytea column — mirrors
    // VercelBlobStorage's existing Buffer.isBuffer coercion.
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await db
      .insert(ledgerReceiptFiles)
      .values({
        key,
        contentType,
        bytes: buf,
        byteSize: buf.byteLength,
      })
      .onConflictDoUpdate({
        target: [ledgerReceiptFiles.key],
        set: {
          contentType,
          bytes: buf,
          byteSize: buf.byteLength,
          // createdAt intentionally omitted — first-write-wins (architect Suggestion)
        },
      });
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const rows = await db
      .select({ bytes: ledgerReceiptFiles.bytes, contentType: ledgerReceiptFiles.contentType })
      .from(ledgerReceiptFiles)
      .where(eq(ledgerReceiptFiles.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { bytes: row.bytes, contentType: row.contentType };
  }

  async delete(key: string): Promise<void> {
    // DELETE ... WHERE on a non-matching key affects 0 rows and does not
    // throw — no existence check needed to satisfy the interface's
    // no-op-on-missing-key contract.
    await db.delete(ledgerReceiptFiles).where(eq(ledgerReceiptFiles.key, key));
  }
}
