/**
 * Words and small pure helpers for the frames page (Slice 4). Client-safe; imports the carrier only.
 */

import type { FrameManifest, FrameWithheldReason } from "./admin-contract";
import type { IndexRow } from "./csv-index";

export const FRAME_FAILURE_REASONS = ["fetch_failed", "not_found", "decode_failed", "render_failed", "encode_failed"] as const;
export type FrameFailureReason = (typeof FRAME_FAILURE_REASONS)[number];

/** One sentence per way a single frame can fail, shown in the failed list and the index CSV. */
export const FRAME_FAILURE_TEXT: Record<FrameFailureReason, string> = {
  fetch_failed: "The portrait could not be downloaded (network problem)",
  not_found: "The portrait is no longer available",
  decode_failed: "The portrait file could not be read as a picture",
  render_failed: "The frame could not be drawn",
  encode_failed: "The frame could not be saved as a JPEG",
};

export const WITHHELD_TEXT: Record<FrameWithheldReason, string> = {
  no_portrait: "no portrait taken yet",
  hidden: "portrait hidden by an admin",
};

/** The server's index-CSV wording for a stuffy that gets no frame. */
export function withheldCsvReason(reason: FrameWithheldReason): string {
  return `No frame: ${WITHHELD_TEXT[reason]}`;
}

export const PURGED_TEXT = "This session's photos have been removed, so there is nothing left to export.";

/** The headline line under "Prepare export". */
export function countsSentence(c: FrameManifest["counts"]): string {
  const frames = `${c.withPortrait} frame${c.withPortrait === 1 ? "" : "s"} to make`;
  const withheld = c.withoutPortrait + c.hidden;
  return withheld === 0 ? frames : `${frames}, ${withheld} left out`;
}

/** "3 portraits retaken since the last export", or null when none. Only meaningful after an earlier export. */
export function retakenSentence(changed: number, lastExportAt: string | null): string | null {
  if (lastExportAt === null || changed <= 0) return null;
  return `${changed} portrait${changed === 1 ? " was" : "s were"} retaken since the last export.`;
}

export function withheldLines(m: Pick<FrameManifest, "withheld">): string[] {
  return m.withheld.map((w) => `${w.name}: ${WITHHELD_TEXT[w.reason]}`);
}

export interface FrameOutcomeMap {
  [stuffyId: string]: { produced: true } | { produced: false; reason: string };
}

/** Index rows for a set of manifest items (with their outcome) plus every withheld stuffy. */
export function indexRowsFor(
  items: FrameManifest["items"],
  withheld: FrameManifest["withheld"],
  outcomes: FrameOutcomeMap,
): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const i of items) {
    const o = outcomes[i.stuffyId];
    rows.push({
      frameNumber: i.frameNumber,
      fileName: i.fileName,
      stuffyName: i.name,
      parentLast: i.parentLast,
      parentFirst: i.parentFirst,
      windowLabel: i.windowLabel,
      consent: i.consent,
      produced: o?.produced === true,
      reason: o === undefined ? "Not attempted" : o.produced ? "" : o.reason,
    });
  }
  for (const w of withheld) {
    rows.push({
      frameNumber: w.frameNumber,
      fileName: w.fileName,
      stuffyName: w.name,
      parentLast: w.parentLast,
      parentFirst: w.parentFirst,
      windowLabel: w.windowLabel,
      consent: w.consent,
      produced: false,
      reason: withheldCsvReason(w.reason),
    });
  }
  return rows;
}

/** The run summary: counts against what THIS run set out to make (all, a subset, or the retried frames). */
export function runSummarySentence(done: number, target: number, failed: number): string {
  return `${done} of ${target} frame${target === 1 ? "" : "s"} done${failed > 0 ? `. ${failed} failed.` : "."}`;
}

/** Retry schedule for a failed frame: 3 tries, waiting 400 ms then 1200 ms between them. */
export const FRAME_ATTEMPTS = 3;
export const FRAME_RETRY_DELAYS_MS = [400, 1200] as const;
export const FRAME_CONCURRENCY = 3;

/** Overlay the chair may drop in later; absent is normal. */
export const FRAME_ART_URL = "/images/santas-workshop/frame-art.png";
