import { describe, expect, it } from "vitest";
import { ADMIN_ERROR_CODES, FRAME_WITHHELD_REASONS, type FrameItem, type FrameWithheld } from "./admin-contract";
import { adminErrorMessage, ADMIN_API } from "./admin-ui";
import { runSummarySentence, countsSentence, FRAME_FAILURE_REASONS, FRAME_FAILURE_TEXT, indexRowsFor, PURGED_TEXT, retakenSentence, WITHHELD_TEXT, withheldCsvReason } from "./frame-export-ui";

describe("frame error and reason sentences", () => {
  it("every failure and withheld reason has a plain sentence", () => {
    for (const r of FRAME_FAILURE_REASONS) expect(FRAME_FAILURE_TEXT[r].length, r).toBeGreaterThan(10);
    for (const r of FRAME_WITHHELD_REASONS) {
      expect(WITHHELD_TEXT[r].length, r).toBeGreaterThan(5);
      expect(withheldCsvReason(r)).toContain(WITHHELD_TEXT[r]);
    }
    expect(Object.keys(FRAME_FAILURE_TEXT).sort()).toEqual([...FRAME_FAILURE_REASONS].sort());
  });

  it("the frames page's server errors read as sentences, not codes", () => {
    for (const code of ["collage_url_not_production", "session_purged", "not_found", "invalid_input", "server_error"] as const) {
      expect(ADMIN_ERROR_CODES).toContain(code);
      expect(adminErrorMessage(code), code).toMatch(/\s/);
    }
    expect(adminErrorMessage("collage_url_not_production")).toContain("real web address");
    expect(PURGED_TEXT).toMatch(/removed/);
  });

  it("the API paths exist", () => {
    expect(ADMIN_API.framesManifest("abc")).toBe("/api/admin/santas-workshop/sessions/abc/frames/manifest");
    expect(ADMIN_API.framesExported("abc")).toBe("/api/admin/santas-workshop/sessions/abc/frames/exported");
  });
});

describe("counts and retake sentences", () => {
  const c = { total: 5, withPortrait: 3, withoutPortrait: 1, hidden: 1, neverExported: 3, changedSinceExport: 0, sinceLastExport: 3 };
  it("counts", () => {
    expect(countsSentence(c)).toBe("3 frames to make, 2 left out");
    expect(countsSentence({ ...c, withPortrait: 1, withoutPortrait: 0, hidden: 0 })).toBe("1 frame to make");
  });
  it("the retaken sentence only appears after an earlier export", () => {
    expect(retakenSentence(2, null)).toBeNull();
    expect(retakenSentence(0, "2026-10-13T00:00:00Z")).toBeNull();
    expect(retakenSentence(1, "2026-10-13T00:00:00Z")).toBe("1 portrait was retaken since the last export.");
    expect(retakenSentence(2, "2026-10-13T00:00:00Z")).toBe("2 portraits were retaken since the last export.");
  });
});

describe("indexRowsFor", () => {
  const item = (n: number, id: string): FrameItem => ({
    stuffyId: id, name: `Bear ${n}`, parentFirst: "A", parentLast: "B", windowLabel: "", consent: false,
    frameNumber: n, fileName: `ssw-t-00${n}.jpg`, portraitPhotoId: `p${n}`, photoUrl: "/x", exportedPhotoId: null, exportStatus: "never",
  });
  const w: FrameWithheld = { stuffyId: "w", name: "Hidden Hen", parentFirst: "", parentLast: "C", windowLabel: "", consent: true, frameNumber: null, fileName: null, reason: "hidden" };
  it("marks produced, failed and not-attempted, and lists withheld", () => {
    const rows = indexRowsFor([item(1, "a"), item(2, "b"), item(3, "c")], [w], { a: { produced: true }, b: { produced: false, reason: "The portrait is no longer available" } });
    expect(rows.map((r) => [r.stuffyName, r.produced, r.reason])).toEqual([
      ["Bear 1", true, ""],
      ["Bear 2", false, "The portrait is no longer available"],
      ["Bear 3", false, "Not attempted"],
      ["Hidden Hen", false, "No frame: portrait hidden by an admin"],
    ]);
  });
});

describe("runSummarySentence", () => {
  it("counts against this run's own target", () => {
    expect(runSummarySentence(1, 1, 0)).toBe("1 of 1 frame done.");
    expect(runSummarySentence(3, 3, 0)).toBe("3 of 3 frames done.");
    expect(runSummarySentence(2, 3, 1)).toBe("2 of 3 frames done. 1 failed.");
  });
});
