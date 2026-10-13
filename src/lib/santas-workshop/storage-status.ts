/**
 * The photo-store banner on the sessions list and the storage checklist item.
 * Reads configuration (booleans and a mode, never a value) and the newest
 * `storage_test` row of the session log (any session: the test is of the
 * deployment, not of one session).
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { swSessionLog } from "@/lib/db/schema";
import type { StorageStatus } from "./admin-contract";
import { describePhotoStoreConfig } from "./photo-store/config";

export async function lastStorageTest(): Promise<{ at: Date; ok: boolean; latencyMs: number | null } | null> {
  const [row] = await db
    .select({ at: swSessionLog.createdAt, detail: swSessionLog.detail })
    .from(swSessionLog)
    .where(eq(swSessionLog.kind, "storage_test"))
    .orderBy(desc(swSessionLog.createdAt))
    .limit(1);
  if (!row) return null;
  const detail = (row.detail ?? {}) as { ok?: unknown; latencyMs?: unknown };
  return { at: row.at, ok: detail.ok === true, latencyMs: typeof detail.latencyMs === "number" ? detail.latencyMs : null };
}

export function storageBannerCause(
  config: { configured: boolean; problem: string | null },
  test: { ok: boolean } | null,
): string | null {
  if (!config.configured) return config.problem ?? "Photo storage is not configured";
  if (test && !test.ok) return "The last photo storage test failed";
  return null;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const config = describePhotoStoreConfig();
  const test = await lastStorageTest();
  return {
    configured: config.configured,
    mode: config.mode,
    lastTest: test ? { at: test.at.toISOString(), ok: test.ok, latencyMs: test.latencyMs } : null,
    bannerCause: storageBannerCause(config, test),
  };
}
