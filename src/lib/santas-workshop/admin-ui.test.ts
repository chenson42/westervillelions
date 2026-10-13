import { describe, expect, it, vi } from "vitest";
import { ADMIN_ERROR_CODES, ATTENTION_CODES, STUFFY_STATES, type SyncCounts, type SyncCursor, type SyncResponse } from "./admin-contract";
import {
  ATTENTION_LABELS,
  STATE_LABELS,
  adminErrorMessage,
  assignQuestion,
  attentionWouldChangeText,
  fieldOfQuestion,
  mapsEqual,
  parseRegistrantFilters,
  refundBadge,
  registrantsHref,
  relativeTime,
  remapSummary,
  runRemapLoop,
  runSyncLoop,
  syncProgressText,
  syncSummary,
  toAdminFailure,
  type CallResult,
} from "./admin-ui";

const counts = (o: Partial<SyncCounts> = {}): SyncCounts => ({
  newFromZeffy: 0, changed: 0, unchanged: 0, goneInZeffy: 0, refundDiffers: 0, skipped: 0, ...o,
});
const cursor = (n: number): SyncCursor => ({
  startedAt: "2026-11-01T00:00:00.000Z", phase: "list", startingAfter: `p${n}`, staleAfterId: null, counts: counts(), processed: n,
});
const page = (n: number, done: boolean, extra: Partial<SyncResponse> = {}): CallResult<SyncResponse> => ({
  ok: true,
  data: { cursor: done ? null : cursor(n), progress: { phase: "list", processed: n, counts: counts({ newFromZeffy: n }) }, done, ...extra },
});

describe("vocabularies have copy", () => {
  it("every error code, attention code and stuffy state has non-empty microcopy", () => {
    for (const c of ADMIN_ERROR_CODES) expect(adminErrorMessage(c, "server text").length).toBeGreaterThan(5);
    for (const c of ATTENTION_CODES) expect(ATTENTION_LABELS[c].length).toBeGreaterThan(3);
    for (const s of STUFFY_STATES) expect(STATE_LABELS[s].length).toBeGreaterThan(3);
  });

  it("never shows a raw server message except for invalid_input", () => {
    expect(adminErrorMessage("server_error", "relation sw_orders does not exist")).not.toContain("relation");
    expect(adminErrorMessage("invalid_input", "Name is required")).toBe("Name is required");
  });

  it("toAdminFailure maps a contract body and falls back for anything else", () => {
    expect(toAdminFailure({ error: "x", code: "slug_taken", field: "slug" })).toMatchObject({ code: "slug_taken", field: "slug" });
    expect(toAdminFailure({ error: "x", code: "made_up" }).code).toBe("server_error");
    expect(toAdminFailure(null).code).toBe("server_error");
  });
});

describe("refundBadge", () => {
  it("is null for none, red for refunded, amber with the amount for a partial flag", () => {
    expect(refundBadge("none", 0)).toBeNull();
    expect(refundBadge("refunded", 4500)?.tone).toBe("red");
    expect(refundBadge("partial_flag", 1500)).toEqual({ label: "Partly refunded ($15.00)", tone: "amber" });
  });
});

describe("runSyncLoop", () => {
  it("posts the cursor back until done and returns the final counts", async () => {
    const post = vi
      .fn<(c: SyncCursor | null) => Promise<CallResult<SyncResponse>>>()
      .mockResolvedValueOnce(page(2, false))
      .mockResolvedValueOnce(page(4, false))
      .mockResolvedValueOnce(page(5, true));
    const seen: number[] = [];
    const out = await runSyncLoop({ post, sleep: async () => {}, onProgress: (p) => seen.push(p.processed) });
    expect(out).toMatchObject({ status: "done", processed: 5 });
    expect(post.mock.calls.map((c) => c[0]?.processed ?? null)).toEqual([null, 2, 4]);
    expect(seen).toEqual([2, 4, 5]);
  });

  it("waits out retryAfterMs and keeps going, flagging the progress as waiting", async () => {
    const post = vi
      .fn<(c: SyncCursor | null) => Promise<CallResult<SyncResponse>>>()
      .mockResolvedValueOnce(page(1, false, { retryAfterMs: 2000 }))
      .mockResolvedValueOnce(page(2, true));
    const sleep = vi.fn(async () => {});
    const waits: boolean[] = [];
    const out = await runSyncLoop({ post, sleep, onProgress: (p) => waits.push(p.waiting) });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(waits).toEqual([true, false]);
    expect(out.status).toBe("done");
    expect(syncProgressText({ phase: "list", processed: 1, counts: counts(), waiting: true })).toBe("Zeffy is limiting requests, continuing...");
  });

  it("stops with a failure, keeping the counts so far", async () => {
    const post = vi
      .fn<(c: SyncCursor | null) => Promise<CallResult<SyncResponse>>>()
      .mockResolvedValueOnce(page(3, false))
      .mockResolvedValueOnce({ ok: false, failure: { code: "zeffy_unavailable", message: "m" } });
    const out = await runSyncLoop({ post, sleep: async () => {}, onProgress: () => {} });
    expect(out).toMatchObject({ status: "error", failure: { code: "zeffy_unavailable" }, counts: { newFromZeffy: 3 } });
  });

  it("honors a stop request between batches and never loops forever", async () => {
    let n = 0;
    const post = async () => page(++n, false);
    const out = await runSyncLoop({ post, sleep: async () => {}, onProgress: () => {}, shouldStop: () => n >= 2 });
    expect(out.status).toBe("stopped");
    const runaway = await runSyncLoop({ post: async () => page(1, false), sleep: async () => {}, onProgress: () => {} });
    expect(runaway.status).toBe("error");
  });
});

describe("syncSummary", () => {
  it("names the missed-webhook case in plain words", () => {
    expect(syncSummary(counts({ newFromZeffy: 2, unchanged: 10 }))).toBe(
      "2 registrations found that the live feed had missed, now added. 10 already up to date.",
    );
    expect(syncSummary(counts({ unchanged: 4 }))).toBe("Everything matches Zeffy. 4 already up to date.");
    expect(syncSummary(counts({ goneInZeffy: 1, refundDiffers: 2 }))).toContain("1 no longer in Zeffy");
  });
});

describe("runRemapLoop", () => {
  it("accumulates batches and posts the last cursor back", async () => {
    const post = vi
      .fn<(c: string | null) => Promise<CallResult<{ cursor: string | null; done: boolean; processed: number; changed: number }>>>()
      .mockResolvedValueOnce({ ok: true, data: { cursor: "a", done: false, processed: 200, changed: 5 } })
      .mockResolvedValueOnce({ ok: true, data: { cursor: null, done: true, processed: 30, changed: 1 } });
    const out = await runRemapLoop({ post });
    expect(out).toEqual({ status: "done", processed: 230, changed: 6 });
    expect(post.mock.calls.map((c) => c[0])).toEqual([null, "a"]);
    expect(remapSummary(230, 6)).toBe("Re-read 230 registrants; 6 changed.");
    expect(remapSummary(0, 0)).toContain("no registrants");
  });

  it("reports a failure with the partial totals", async () => {
    const out = await runRemapLoop({
      post: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: { cursor: "a", done: false, processed: 10, changed: 2 } })
        .mockResolvedValueOnce({ ok: false, failure: { code: "server_error", message: "m" } }),
    });
    expect(out).toMatchObject({ status: "error", processed: 10, changed: 2 });
  });
});

describe("question map editing", () => {
  it("assigns a normalized text to one field and moves it when reassigned", () => {
    let m = assignQuestion({}, "Stuffy's name *", "stuffy_name");
    expect(m).toEqual({ stuffy_name: ["stuffy's name"] });
    m = assignQuestion(m, "STUFFY'S NAME", "snack");
    expect(m).toEqual({ snack: ["stuffy's name"] });
    expect(fieldOfQuestion(m, "Stuffy's name:")).toBe("snack");
  });

  it("unassigning removes it and drops the empty field; ignored is just another key", () => {
    const m = assignQuestion({ ignored: ["anything else"] }, "Anything else?", null);
    expect(m).toEqual({});
    expect(assignQuestion({}, "Anything else?", "ignored")).toEqual({ ignored: ["anything else"] });
  });

  it("several strings may share a field; mapsEqual ignores order and empties", () => {
    const a = assignQuestion(assignQuestion({}, "Name one", "stuffy_name"), "Name two", "stuffy_name");
    expect(a.stuffy_name).toHaveLength(2);
    expect(mapsEqual(a, { stuffy_name: ["name two", "name one"], snack: [] })).toBe(true);
    expect(mapsEqual(a, {})).toBe(false);
  });

  it("explains the after-save effect", () => {
    expect(attentionWouldChangeText(0)).toContain("No registrant");
    expect(attentionWouldChangeText(1)).toContain("1 registrant will");
    expect(attentionWouldChangeText(3)).toContain("3 registrants will");
  });
});

describe("registrant filters", () => {
  it("drops unknown values and clamps page and search length", () => {
    expect(parseRegistrantFilters({ state: "bogus", flag: "attention", q: "  bear ", page: "0" })).toEqual({
      state: "", flag: "attention", q: "bear", page: 1,
    });
    expect(parseRegistrantFilters({ q: "x".repeat(500) }).q).toHaveLength(100);
    expect(parseRegistrantFilters({ page: "abc" }).page).toBe(1);
    expect(parseRegistrantFilters({ state: "tagged", page: 3 })).toMatchObject({ state: "tagged", page: 3 });
  });

  it("builds a stable href and omits defaults", () => {
    expect(registrantsHref("s1", {})).toBe("/admin/santas-workshop/s1/registrants");
    expect(registrantsHref("s1", { flag: "refund", q: "a b", page: 2 })).toBe("/admin/santas-workshop/s1/registrants?flag=refund&q=a+b&page=2");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("handles never, minutes, hours and days", () => {
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("2026-11-01T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-01T11:30:00Z", now)).toBe("30 minutes ago");
    expect(relativeTime("2026-11-01T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-25T12:00:00Z", now)).toBe("7 days ago");
  });
});

import { ADMIN_API, formatEasternInstant, slugify, suggestSlug } from "./admin-ui";

describe("dates and urls", () => {
  it("formats an instant in Eastern, not UTC", () => {
    expect(formatEasternInstant("2026-11-08T14:05:00Z")).toBe("Nov 8, 2026, 9:05 AM");
    expect(formatEasternInstant(null)).toBe("never");
    // A UTC instant in summer shows 4 hours earlier (EDT), never the UTC clock time.
    expect(formatEasternInstant("2026-10-13T05:30:00.000Z")).toBe("Oct 13, 2026, 1:30 AM");
    expect(formatEasternInstant("nope")).toBe("never");
  });

  it("suggests and sanitizes slugs the validator will accept", () => {
    expect(suggestSlug("practice", "2026-12-18")).toBe("practice-2026");
    expect(suggestSlug("real", "2026-12-18")).toBe("workshop-2026");
    expect(slugify("  A Visit to Santa's Workshop! ")).toBe("a-visit-to-santa-s-workshop");
    expect(slugify("x".repeat(80))).toHaveLength(40);
  });

  it("encodes ids placed in a path", () => {
    expect(ADMIN_API.sync("a/b")).toBe("/api/admin/santas-workshop/sessions/a%2Fb/zeffy/sync");
  });
});

import { ATTENTION_LABELS as LABELS, labelChangeNotice } from "./admin-ui";

describe("window edit copy", () => {
  it("window_in_use names the remedy and unmapped_window ends with it", () => {
    expect(adminErrorMessage("window_in_use")).toContain("change its label");
    expect(LABELS.unmapped_window.endsWith("Fix the label under Edit session, then run Remap.")).toBe(true);
  });

  it("the post-save Remap notice appears only when a label changed", () => {
    expect(labelChangeNotice(false)).toBeNull();
    expect(labelChangeNotice(true)).toContain("not updated until you run Remap");
  });
});

import { connectSuccessNote, eventCodeSentence } from "./admin-ui";

describe("Sync outcome with skipped payments (N1)", () => {
  it("names the skipped count and never shows the all-clear when any were skipped", () => {
    const text = syncSummary(counts({ unchanged: 4, skipped: 2 }));
    expect(text).toContain("Synced 4 orders");
    expect(text).toContain("2 payments skipped because their ticket rate is not marked as the stuffy ticket");
    expect(text).toContain("Review under Connect");
    expect(text).not.toContain("Everything matches Zeffy");
    expect(syncSummary(counts({ unchanged: 1, skipped: 1 }))).toContain("1 payment skipped because its ticket rate");
  });

  it("adds the skipped sentence after real changes too, and shows the all-clear only when nothing was skipped", () => {
    const text = syncSummary(counts({ newFromZeffy: 1, unchanged: 3, skipped: 5 }));
    expect(text).toContain("1 registration found that the live feed had missed");
    expect(text).toContain("5 payments skipped");
    expect(syncSummary(counts({ unchanged: 3, skipped: 0 }))).toBe("Everything matches Zeffy. 3 already up to date.");
    expect(syncSummary(counts({ newFromZeffy: 1, unchanged: 3 }))).not.toContain("skipped");
  });
});

describe("connectSuccessNote (N2)", () => {
  it("prompts Run Sync now with the button when the API key is set", () => {
    const n = connectSuccessNote(true, true);
    expect(n.offerSync).toBe(true);
    expect(n.text).toContain("Run Sync now");
    expect(n.text).toContain("Zeffy confirmed");
  });

  it("without a key it explains instead of offering a button that cannot work, and keeps the unverified warning", () => {
    const n = connectSuccessNote(false, false);
    expect(n.offerSync).toBe(false);
    expect(n.text).toContain("needs the Zeffy API key");
    expect(n.text).toContain("exactly as you typed");
  });
});

describe("eventCodeSentence (N3)", () => {
  it("turns no_api_key into a sentence with the remedy, and falls back for an unknown code", () => {
    expect(eventCodeSentence("no_api_key")).toBe(
      "Zeffy could not be asked for this payment because the API key is not set. Set it and press Reprocess.",
    );
    expect(eventCodeSentence("brand_new_code")).toContain("webmaster");
  });
});
