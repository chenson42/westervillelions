// Browser-only export engine (DECISION-124): fetch each portrait through the photo door, composite,
// zip in parts, mark exported. No server imports; React-free so the panel only renders its callbacks.

import type { FrameItem, FrameManifest, FramesExportedRequest, FramesExportedResponse } from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin } from "@/lib/santas-workshop/admin-ui";
import {
  FRAME_ATTEMPTS,
  FRAME_CONCURRENCY,
  FRAME_FAILURE_TEXT,
  FRAME_RETRY_DELAYS_MS,
  type FrameFailureReason,
  type FrameOutcomeMap,
} from "@/lib/santas-workshop/frame-export-ui";
import { framePartFileName } from "@/lib/santas-workshop/frame-names";
import { buildZip, planParts, type ZipFile } from "@/lib/santas-workshop/zip-parts";
import { buildQrMatrix, composeFrameJpeg, FrameError, layoutFor, loadFrameArt, type FrameArt, type QrMatrix } from "./frame-compose";

export interface ReadyPart {
  number: number;
  of: number;
  /** Zip file name. */
  fileName: string;
  blob: Blob;
  produced: number;
  failed: number;
  /** Set when the app could not record this part as exported (the zip itself is fine). */
  markError: string | null;
}

export interface RunProgress {
  /** Frames settled (produced or failed) in this run. */
  done: number;
  total: number;
  part: number;
  parts: number;
  currentName: string;
}

export interface RunHandlers {
  onProgress(p: RunProgress): void;
  onPart(part: ReadyPart): void;
}

export interface RunResult {
  outcomes: FrameOutcomeMap;
  failedItems: FrameItem[];
  cancelled: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPortrait(item: FrameItem): Promise<ImageBitmap> {
  let res: Response;
  try {
    res = await fetch(item.photoUrl, { credentials: "include" });
  } catch {
    throw new FrameError("fetch_failed");
  }
  if (res.status === 404) throw new FrameError("not_found");
  if (!res.ok) throw new FrameError("fetch_failed");
  try {
    return await createImageBitmap(await res.blob());
  } catch {
    throw new FrameError("decode_failed");
  }
}

/** One frame with up to 3 tries; a missing or unreadable portrait is not retried. */
async function produceOne(item: FrameItem, ctx: { qr: QrMatrix; art: FrameArt; practice: boolean; year: string }): Promise<Uint8Array> {
  let last: FrameFailureReason = "fetch_failed";
  for (let attempt = 1; attempt <= FRAME_ATTEMPTS; attempt += 1) {
    try {
      const bitmap = await fetchPortrait(item);
      try {
        return await composeFrameJpeg({ portrait: bitmap, name: item.name, frameNumber: item.frameNumber, year: ctx.year, practice: ctx.practice, qr: ctx.qr, layout: layoutFor(ctx.qr, ctx.practice), art: ctx.art });
      } finally {
        bitmap.close();
      }
    } catch (e) {
      last = e instanceof FrameError ? e.reason : "render_failed";
      if (last === "not_found" || last === "decode_failed") break;
      if (attempt < FRAME_ATTEMPTS) await sleep(FRAME_RETRY_DELAYS_MS[attempt - 1] ?? 1200);
    }
  }
  throw new FrameError(last);
}

export interface RunInput {
  sessionId: string;
  manifest: FrameManifest;
  /** The items to produce this run (all of them, or only the ones that failed before). */
  items: FrameItem[];
  /** Outcomes already known from earlier runs of the same export, merged into the result. */
  previous: FrameOutcomeMap;
  practice: boolean;
  year: string;
  /** Zip names: part k of n, or a retry zip when `retry` is set. */
  retry: number | null;
  /** True when `items` is a subset of the manifest: zips get a "-new" suffix so they never collide with a full export. */
  subset: boolean;
  signal: AbortSignal;
}

export async function runFrameExport(input: RunInput, handlers: RunHandlers): Promise<RunResult> {
  const { manifest } = input;
  const qr = await buildQrMatrix(manifest.qrPayload);
  const art = await loadFrameArt();
  const { zipSync } = await import("fflate");
  const ctx = { qr, art, practice: input.practice, year: input.year };

  const outcomes: FrameOutcomeMap = { ...input.previous };
  const parts = input.retry === null ? planParts(input.items.length, manifest.partSize) : [{ start: 0, end: input.items.length }];
  const total = input.items.length;
  let done = 0;
  let cancelled = false;

  for (let p = 0; p < parts.length && !cancelled; p += 1) {
    const slice = input.items.slice(parts[p].start, parts[p].end);
    const files: ZipFile[] = [];
    const producedItems: FrameItem[] = [];
    let cursor = 0;

    const worker = async () => {
      while (!input.signal.aborted) {
        const i = cursor;
        cursor += 1;
        if (i >= slice.length) return;
        const item = slice[i];
        handlers.onProgress({ done, total, part: p + 1, parts: parts.length, currentName: item.name });
        try {
          const jpeg = await produceOne(item, ctx);
          files.push({ name: item.fileName, data: jpeg });
          producedItems.push(item);
          outcomes[item.stuffyId] = { produced: true };
        } catch (e) {
          const reason = e instanceof FrameError ? e.reason : "render_failed";
          outcomes[item.stuffyId] = { produced: false, reason: FRAME_FAILURE_TEXT[reason] };
        }
        done += 1;
        handlers.onProgress({ done, total, part: p + 1, parts: parts.length, currentName: item.name });
      }
    };
    await Promise.all(Array.from({ length: Math.min(FRAME_CONCURRENCY, slice.length) }, worker));
    if (input.signal.aborted) {
      cancelled = true;
      break;
    }

    // Every frame in the slice is now produced or listed as failed: the part may be offered. The zip holds pictures only.
    files.sort((a, b) => (a.name < b.name ? -1 : 1));
    const zip = buildZip(files, zipSync);

    let markError: string | null = null;
    if (producedItems.length > 0) {
      const body: FramesExportedRequest = {
        items: producedItems.map((i) => ({ stuffyId: i.stuffyId, photoId: i.portraitPhotoId, frameNumber: i.frameNumber })),
        partial: p < parts.length - 1,
      };
      const res = await callAdmin<FramesExportedResponse>(ADMIN_API.framesExported(input.sessionId), { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) markError = res.failure.message;
    }

    const fileName = input.retry === null ? framePartFileName(manifest.filePrefix, p + 1, parts.length, input.subset ? "-new" : "") : `${manifest.filePrefix}-frames-retry-${input.retry}.zip`;
    handlers.onPart({
      number: p + 1,
      of: parts.length,
      fileName,
      blob: new Blob([zip as BlobPart], { type: "application/zip" }),
      produced: producedItems.length,
      failed: slice.length - producedItems.length,
      markError,
    });
  }

  const failedItems = input.items.filter((i) => outcomes[i.stuffyId]?.produced === false);
  return { outcomes, failedItems, cancelled };
}
