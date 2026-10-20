import { describe, expect, it, vi } from "vitest";
import {
  CREATE_CODE_KIND,
  DRIFT_MESSAGE,
  NOT_RECORDED_MESSAGE,
  UNCONFIRMED_MESSAGE,
  UNKNOWN_OUTCOME_MESSAGE,
  canSubmitSweep,
  createSweepPostController,
  describeBankDifference,
  describeFoundationReceipt,
  interpretCreateFailure,
  interpretVerification,
  isFutureSweepDate,
  reviewDrifted,
  reviewSignature,
  selectAllIds,
  sweepTierLine,
  type SweepPostBody,
  type SweepSubmitState,
} from "./sweep-builder-logic";
import {
  SWEEP_BATCH_MAX,
  SWEEP_ERROR_COPY,
  SWEEP_INT4_MAX,
  type SweepErrorCode,
  type SweepPreviewResponse,
  type SweepPreviewRow,
} from "@/lib/ledger-sweep";
import { DEFAULT_FUND_LABELS } from "@/lib/ledger-fund-labels";

const LABELS = { ...DEFAULT_FUND_LABELS, activity: "Community Fund" };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function row(over: Partial<SweepPreviewRow> = {}): SweepPreviewRow {
  return {
    sourceId: A,
    giftDate: "2026-09-01",
    amountCents: 5000,
    party: "Example Donor",
    categoryName: "Donations",
    foundationCategoryId: "cat-1",
    foundationCategoryName: "Foundation donations",
    foundationReceipt: "may_be_needed",
    receiptSentOn: null,
    flags: [],
    refusal: null,
    ...over,
  };
}

function preview(over: Partial<SweepPreviewResponse> = {}): SweepPreviewResponse {
  return {
    rows: [row()],
    totalCents: 5000,
    count: 1,
    tier: "record",
    needsReason: false,
    status: "posted",
    thresholdCents: 10000,
    fiscalYears: [2026],
    sentStatementMonths: [],
    warnings: [],
    typedBankAmountCents: null,
    differenceCents: null,
    canPost: true,
    ...over,
  };
}

describe("sweepTierLine (B2)", () => {
  it("is null for count 0", () => {
    expect(sweepTierLine(preview({ rows: [], count: 0, totalCents: 0, canPost: false }))).toBeNull();
  });

  it("is null for an all-refused preview, even when the server says manage", () => {
    const refused = preview({
      rows: [row({ refusal: "manage_required" })],
      count: 0,
      totalCents: 0,
      tier: "manage",
      needsReason: true,
      canPost: false,
    });
    expect(sweepTierLine(refused)).toBeNull();
  });

  it("says posts now, or goes to the board, and adds the reason line only for manage", () => {
    const posted = sweepTierLine(preview());
    expect(posted?.statusLine).toContain("posts right away");
    expect(posted?.tierLine).toBeNull();
    const pending = sweepTierLine(preview({ status: "pending", tier: "manage", needsReason: true }));
    expect(pending?.statusLine).toContain("goes to the board");
    expect(pending?.tierLine).toContain("Manage Ledger");
  });
});

describe("reviewSignature and reviewDrifted (B7)", () => {
  it("an identical preview does not drift, and typed-amount fields are ignored", () => {
    expect(reviewDrifted(preview(), preview())).toBe(false);
    expect(reviewDrifted(preview(), preview({ typedBankAmountCents: 5000, differenceCents: 0 }))).toBe(false);
  });

  it("a changed Foundation category drifts", () => {
    const changed = preview({ rows: [row({ foundationCategoryId: "cat-2", foundationCategoryName: "Other" })] });
    expect(reviewDrifted(preview(), changed)).toBe(true);
  });

  it("a changed receipt state drifts", () => {
    expect(reviewDrifted(preview(), preview({ rows: [row({ foundationReceipt: "not_needed" })] }))).toBe(true);
  });

  it("a new refusal drifts", () => {
    const refused = preview({ rows: [row({ refusal: "already_swept" })], count: 0, totalCents: 0, canPost: false });
    expect(reviewDrifted(preview(), refused)).toBe(true);
  });

  it("a total change drifts", () => {
    expect(reviewDrifted(preview(), preview({ totalCents: 5001 }))).toBe(true);
  });

  it("a status flip drifts", () => {
    expect(reviewDrifted(preview(), preview({ status: "pending" }))).toBe(true);
  });

  it("a new flag or warning drifts", () => {
    expect(reviewDrifted(preview(), preview({ rows: [row({ flags: ["no_donor"] })] }))).toBe(true);
    expect(
      reviewDrifted(preview(), preview({ warnings: [{ code: "no_donor", count: 1 }] })),
    ).toBe(true);
  });

  it("the flag order does not matter", () => {
    const a = preview({ rows: [row({ flags: ["no_donor", "prior_fiscal_year"] })] });
    const b = preview({ rows: [row({ flags: ["prior_fiscal_year", "no_donor"] })] });
    expect(reviewSignature(a)).toBe(reviewSignature(b));
  });
});

describe("isFutureSweepDate (B5)", () => {
  it("refuses tomorrow and allows today and the past", () => {
    expect(isFutureSweepDate("2026-10-20", "2026-10-19")).toBe(true);
    expect(isFutureSweepDate("2026-10-19", "2026-10-19")).toBe(false);
    expect(isFutureSweepDate("2026-10-01", "2026-10-19")).toBe(false);
  });
});

describe("canSubmitSweep", () => {
  const ready: SweepSubmitState = {
    preview: preview(),
    typedCents: 5000,
    boardMinute: "October motion",
    priorYearReason: "",
    sweepDate: "2026-10-19",
    today: "2026-10-19",
    submitting: false,
    previewLoading: false,
  };

  it("is true when everything is in order", () => {
    expect(canSubmitSweep(ready)).toBe(true);
  });

  it("gates on each requirement", () => {
    expect(canSubmitSweep({ ...ready, preview: null })).toBe(false);
    expect(canSubmitSweep({ ...ready, preview: preview({ canPost: false }) })).toBe(false);
    expect(canSubmitSweep({ ...ready, preview: preview({ rows: [], count: 0, totalCents: 0 }) })).toBe(false);
    expect(canSubmitSweep({ ...ready, typedCents: null })).toBe(false);
    expect(canSubmitSweep({ ...ready, typedCents: 4999 })).toBe(false);
    expect(canSubmitSweep({ ...ready, boardMinute: "   " })).toBe(false);
    expect(canSubmitSweep({ ...ready, boardMinute: "x".repeat(10_000) })).toBe(false);
    expect(canSubmitSweep({ ...ready, sweepDate: "2026-10-20" })).toBe(false);
    expect(canSubmitSweep({ ...ready, sweepDate: "" })).toBe(false);
    expect(canSubmitSweep({ ...ready, submitting: true })).toBe(false);
    expect(canSubmitSweep({ ...ready, previewLoading: true })).toBe(false);
  });

  it("refuses a total above the integer limit even if the preview says canPost (B1)", () => {
    const huge = preview({ totalCents: SWEEP_INT4_MAX + 1, canPost: true });
    expect(canSubmitSweep({ ...ready, preview: huge, typedCents: SWEEP_INT4_MAX + 1 })).toBe(false);
  });

  it("needs a valid reason only when the preview needs one", () => {
    const needs = preview({ needsReason: true, tier: "manage" });
    expect(canSubmitSweep({ ...ready, preview: needs })).toBe(false);
    expect(canSubmitSweep({ ...ready, preview: needs, priorYearReason: "short" })).toBe(false);
    expect(
      canSubmitSweep({ ...ready, preview: needs, priorYearReason: "Gifts from last year were missed." }),
    ).toBe(true);
  });
});

describe("describeBankDifference", () => {
  it("is null when empty or equal and names the direction otherwise", () => {
    expect(describeBankDifference(5000, null)).toBeNull();
    expect(describeBankDifference(5000, 5000)).toBeNull();
    expect(describeBankDifference(5000, 5100)).toBe("That is $1.00 more than the selected gifts total.");
    expect(describeBankDifference(5000, 4000)).toBe("That is $10.00 less than the selected gifts total.");
  });
});

describe("interpretCreateFailure (B6)", () => {
  const base = { priorAttempt: false, labels: LABELS };

  it("201 is created", () => {
    const created = { legId: "leg", transferGroupId: "g", copyIds: [], status: "posted", totalCents: 1, count: 1 };
    expect(interpretCreateFailure({ ...base, status: 201, body: created })).toEqual({ kind: "created", created });
  });

  it("rows_claimed with no earlier attempt means someone else got there first", () => {
    const out = interpretCreateFailure({
      ...base,
      status: 409,
      body: { error: "x", code: "rows_claimed" },
    });
    expect(out.kind).toBe("refresh");
  });

  it("rows_claimed after our own attempt is an unknown outcome, never a failure", () => {
    const out = interpretCreateFailure({
      ...base,
      priorAttempt: true,
      status: 409,
      body: { error: "x", code: "rows_claimed" },
    });
    expect(out).toEqual({ kind: "verify" });
  });

  it("rows_refused keeps the per-row codes", () => {
    const rows = [{ sourceId: A, code: "already_swept" as const }];
    const out = interpretCreateFailure({ ...base, status: 409, body: { error: "x", code: "rows_refused", rows } });
    expect(out).toMatchObject({ kind: "refresh", rows });
  });

  it("total_mismatch names both amounts", () => {
    const out = interpretCreateFailure({
      ...base,
      status: 400,
      body: { error: SWEEP_ERROR_COPY.total_mismatch(LABELS), code: "total_mismatch", derivedCents: 5000, typedCents: 4000 },
    });
    expect(out).toMatchObject({ kind: "fix" });
    expect((out as { message: string }).message).toContain("$50.00");
    expect((out as { message: string }).message).toContain("$40.00");
  });

  it("manage_required is denied", () => {
    expect(
      interpretCreateFailure({ ...base, status: 403, body: { error: "no", code: "manage_required" } }),
    ).toMatchObject({ kind: "denied" });
  });

  it("a network error and a 500 are unknown outcomes", () => {
    expect(interpretCreateFailure({ ...base, status: null, body: null })).toEqual({ kind: "verify" });
    expect(interpretCreateFailure({ ...base, status: 500, body: { error: "boom" } })).toEqual({ kind: "verify" });
    expect(interpretCreateFailure({ ...base, status: 504, body: null })).toEqual({ kind: "verify" });
  });

  it("every SweepErrorCode is mapped, and each maps to a sentence", () => {
    for (const code of Object.keys(SWEEP_ERROR_COPY) as SweepErrorCode[]) {
      expect(CREATE_CODE_KIND[code], code).toBeDefined();
      const out = interpretCreateFailure({
        ...base,
        status: 400,
        body: { error: "", code },
      });
      expect(out.kind === "verify", code).toBe(false);
      if (out.kind !== "created" && out.kind !== "verify") expect(out.message.length, code).toBeGreaterThan(0);
    }
  });
});

describe("interpretVerification (B6)", () => {
  it("all already_swept is the neutral batch panel", () => {
    expect(
      interpretVerification(preview({ rows: [row({ refusal: "already_swept" })], count: 0, totalCents: 0 })),
    ).toBe("already_in_batch");
  });
  it("nothing swept and nothing refused means it was not recorded", () => {
    expect(interpretVerification(preview())).toBe("not_recorded");
  });
  it("a mix, or no answer, is unconfirmed", () => {
    expect(
      interpretVerification(
        preview({ rows: [row({ refusal: "already_swept" }), row({ sourceId: B })], count: 1 }),
      ),
    ).toBe("unconfirmed");
    expect(interpretVerification(null)).toBe("unconfirmed");
  });
});

describe("createSweepPostController (B6, B7)", () => {
  const body: SweepPostBody = {
    sourceIds: [A],
    sourceBankAccountId: "s",
    destBankAccountId: "d",
    sweepDate: "2026-10-19",
    bankAmountCents: 5000,
    boardMinute: "Motion",
  };
  const created = { legId: "leg", transferGroupId: "g", copyIds: ["c"], status: "posted", totalCents: 5000, count: 1 };

  function fakeFetch(handler: (url: string, n: number) => { status: number; body: unknown } | "throw") {
    let calls = 0;
    const log: string[] = [];
    const fn = vi.fn(async (url: string) => {
      calls += 1;
      log.push(url);
      const out = handler(url, calls);
      if (out === "throw") throw new Error("network");
      return { status: out.status, json: async () => out.body };
    });
    return { fn, log };
  }

  it("two synchronous Post calls send exactly one create", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/preview") ? { status: 200, body: preview() } : { status: 201, body: created },
    );
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    const [first, second] = await Promise.all([
      c.post({ body, reviewed: preview() }),
      c.post({ body, reviewed: preview() }),
    ]);
    expect(first.kind).toBe("created");
    expect(second.kind).toBe("ignored");
    expect(f.log.filter((u) => u.endsWith("/sweep-batches"))).toHaveLength(1);
    // And a later call after a success is still ignored.
    expect((await c.post({ body, reviewed: preview() })).kind).toBe("ignored");
    expect(f.log.filter((u) => u.endsWith("/sweep-batches"))).toHaveLength(1);
  });

  it("writes nothing and reports drift when the pre-post preview differs", async () => {
    const changed = preview({ rows: [row({ foundationCategoryId: "cat-2" })] });
    const f = fakeFetch(() => ({ status: 200, body: changed }));
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    const out = await c.post({ body, reviewed: preview() });
    expect(out).toEqual({ kind: "drifted", preview: changed });
    expect(f.log.every((u) => u.endsWith("/preview"))).toBe(true);
    expect(DRIFT_MESSAGE).toContain("changed while you were reviewing");
  });

  it("a network error on create becomes the neutral panel when the gifts are already swept", async () => {
    const swept = preview({ rows: [row({ refusal: "already_swept" })], count: 0, totalCents: 0, canPost: false });
    let previews = 0;
    const f = fakeFetch((url) => {
      if (url.endsWith("/preview")) {
        previews += 1;
        return { status: 200, body: previews === 1 ? preview() : swept };
      }
      return "throw";
    });
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    const out = await c.post({ body, reviewed: preview() });
    expect(out).toEqual({ kind: "already_in_batch", message: UNKNOWN_OUTCOME_MESSAGE });
    // No retry from an unknown outcome.
    expect((await c.post({ body, reviewed: preview() })).kind).toBe("ignored");
  });

  it("a 500 whose check shows nothing landed allows a retry", async () => {
    let creates = 0;
    const f = fakeFetch((url) => {
      if (url.endsWith("/preview")) return { status: 200, body: preview() };
      creates += 1;
      return creates === 1 ? { status: 500, body: { error: "boom" } } : { status: 201, body: created };
    });
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    expect(await c.post({ body, reviewed: preview() })).toEqual({ kind: "not_recorded", message: NOT_RECORDED_MESSAGE });
    expect((await c.post({ body, reviewed: preview() })).kind).toBe("created");
  });

  it("an unreadable check is unconfirmed, never failed", async () => {
    let previews = 0;
    const f = fakeFetch((url) => {
      if (url.endsWith("/preview")) {
        previews += 1;
        return previews === 1 ? { status: 200, body: preview() } : { status: 500, body: null };
      }
      return { status: 502, body: null };
    });
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    expect(await c.post({ body, reviewed: preview() })).toEqual({ kind: "unconfirmed", message: UNCONFIRMED_MESSAGE });
  });

  it("rows_claimed on the first send is someone else (refresh); a later retry reads as our own", async () => {
    const claimed = { status: 409, body: { error: "x", code: "rows_claimed" } };
    const f = fakeFetch((url) => (url.endsWith("/preview") ? { status: 200, body: preview() } : claimed));
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    expect((await c.post({ body, reviewed: preview() })).kind).toBe("refresh");
    // A second send from the same page: the claim now reads as our own earlier attempt.
    const second = await c.post({ body, reviewed: preview() });
    expect(["not_recorded", "already_in_batch", "unconfirmed"]).toContain(second.kind);
  });

  it("a server fix error keeps the review open and allows another try", async () => {
    let creates = 0;
    const f = fakeFetch((url) => {
      if (url.endsWith("/preview")) return { status: 200, body: preview() };
      creates += 1;
      return creates === 1
        ? { status: 400, body: { error: SWEEP_ERROR_COPY.minute_required(LABELS), code: "minute_required" } }
        : { status: 201, body: created };
    });
    const c = createSweepPostController({ fetch: f.fn, labels: LABELS });
    expect((await c.post({ body, reviewed: preview() })).kind).toBe("fix");
    expect((await c.post({ body, reviewed: preview() })).kind).toBe("created");
  });
});

describe("selectAllIds", () => {
  it("caps at one batch", () => {
    const ids = Array.from({ length: SWEEP_BATCH_MAX + 5 }, (_, i) => String(i));
    const out = selectAllIds(ids);
    expect(out.ids).toHaveLength(SWEEP_BATCH_MAX);
    expect(out.capped).toBe(true);
    expect(selectAllIds(["a"]).capped).toBe(false);
  });
});

describe("describeFoundationReceipt", () => {
  it("has a sentence for every state", () => {
    expect(describeFoundationReceipt("may_be_needed", null)).toContain("may need");
    expect(describeFoundationReceipt("not_needed", null)).toBe("No receipt needed.");
    expect(describeFoundationReceipt("already_sent", "2026-03-04")).toContain("Mar 4, 2026");
  });
});
