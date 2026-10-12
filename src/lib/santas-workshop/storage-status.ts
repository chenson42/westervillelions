import type { StorageStatus } from "./admin-contract";

/**
 * The photo-store banner shown on the sessions list. The photo store lands in
 * Slice 2; until then the contract field exists and says "not configured" so
 * the list page can already render a banner slot.
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  return { configured: false, lastTest: null, bannerCause: null };
}
