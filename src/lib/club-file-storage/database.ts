/**
 * DatabaseClubFileStorage adapter — mirrors DatabaseReceiptStorage (DECISION-040),
 * backed by the sibling `club_file_blobs` table (DECISION-094).
 *
 * Used in production (NODE_ENV === "production"). Bytes live in
 * `club_file_blobs`, keyed by the same opaque `club-files/<uuid>/<name>` key
 * format as the other two adapters.
 *
 * `save()` is an upsert (`INSERT ... ON CONFLICT (key) DO UPDATE`) — a
 * re-upload under the same key must not throw. `created_at` is deliberately
 * NOT included in the `DO UPDATE SET` list: first-write-wins for the
 * timestamp, matching the receipt storage adapter's precedent.
 */

import { db } from "@/lib/db";
import { clubFileBlobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ClubFileStorage } from "./index";

export class DatabaseClubFileStorage implements ClubFileStorage {
  async save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
    // Ensure we pass a proper Buffer to the bytea column.
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await db
      .insert(clubFileBlobs)
      .values({
        key,
        contentType,
        bytes: buf,
        byteSize: buf.byteLength,
      })
      .onConflictDoUpdate({
        target: [clubFileBlobs.key],
        set: {
          contentType,
          bytes: buf,
          byteSize: buf.byteLength,
          // createdAt intentionally omitted — first-write-wins
        },
      });
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const rows = await db
      .select({ bytes: clubFileBlobs.bytes, contentType: clubFileBlobs.contentType })
      .from(clubFileBlobs)
      .where(eq(clubFileBlobs.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { bytes: row.bytes, contentType: row.contentType };
  }

  async delete(key: string): Promise<void> {
    // DELETE ... WHERE on a non-matching key affects 0 rows and does not
    // throw — no existence check needed to satisfy the interface's
    // no-op-on-missing-key contract.
    await db.delete(clubFileBlobs).where(eq(clubFileBlobs.key, key));
  }
}
