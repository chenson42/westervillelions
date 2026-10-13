/** Request validation for POST frames/exported. Pure; kept out of the route file (a route may export only handlers). */

import { isUuid } from "@/lib/utils";
import { FRAME_EXPORTED_MAX_ITEMS, type FramesExportedItem } from "./admin-contract";

export function parseExportedItems(body: unknown): FramesExportedItem[] | null {
  const raw = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw) || raw.length > FRAME_EXPORTED_MAX_ITEMS) return null;
  const out: FramesExportedItem[] = [];
  for (const r of raw) {
    const i = r as Partial<FramesExportedItem> | null;
    if (
      !i ||
      typeof i.stuffyId !== "string" ||
      !isUuid(i.stuffyId) ||
      typeof i.photoId !== "string" ||
      !isUuid(i.photoId) ||
      typeof i.frameNumber !== "number" ||
      !Number.isInteger(i.frameNumber) ||
      i.frameNumber < 1
    ) {
      return null;
    }
    out.push({ stuffyId: i.stuffyId, photoId: i.photoId, frameNumber: i.frameNumber });
  }
  return out;
}
