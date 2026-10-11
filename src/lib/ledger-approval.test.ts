import { describe, it, expect } from "vitest";
import {
  APPROVAL_TABS,
  RECENT_DECISIONS_LIMIT,
  approvalNounLabel,
  buildApprovalBanner,
  describePendingCount,
  formatApprovalDollars,
  formatDecisionDateTime,
  parseApprovalTab,
  type ApprovalTargetState,
  type DecidedApprovalRow,
  describeApprovalConflict,
  describeApprovalFund,
  displayDeciderName,
  isApprovalConflict,
  cosignEligibility,
  formatApproverList,
  isCosignConflict,
  isCosignForbidden,
  type ApprovalConflictBody,
  type CosignerView,
} from "./ledger-approval";

const base: ApprovalConflictBody = {
  error: "Transaction is no longer pending",
  code: "not_pending",
  decision: "approved",
  deciderName: "Pat Example",
  decidedAt: "2026-10-10T15:42:00.000Z",
  decidedByViewer: false,
};

describe("describeApprovalFund", () => {
  it("treats a same-entity pair as a Transfer", () => {
    expect(
      describeApprovalFund({ fundName: "Admin Fund", partnerFundName: "Activity Fund", entityId: "e1", partnerEntityId: "e1" }),
    ).toEqual({ kind: "transfer", text: "Admin Fund → Activity Fund" });
  });
  it("treats a cross-entity pair as a Sweep", () => {
    expect(
      describeApprovalFund({ fundName: "Activity Fund", partnerFundName: "Charitable Fund", entityId: "e1", partnerEntityId: "e2" }).kind,
    ).toBe("sweep");
  });
  it("returns plain for a row with no partner", () => {
    expect(
      describeApprovalFund({ fundName: "Admin Fund", partnerFundName: null, entityId: "e1", partnerEntityId: null }),
    ).toEqual({ kind: "plain", text: "Admin Fund" });
  });
  it("reads a null fund name as Unknown Fund", () => {
    expect(
      describeApprovalFund({ fundName: null, partnerFundName: null, entityId: "e1", partnerEntityId: null }).text,
    ).toBe("Unknown Fund");
    expect(
      describeApprovalFund({ fundName: null, partnerFundName: "B", entityId: "e1", partnerEntityId: "e1" }).text,
    ).toBe("Unknown Fund → B");
  });
});

describe("displayDeciderName", () => {
  it("returns null for null, empty and blank", () => {
    expect(displayDeciderName(null)).toBeNull();
    expect(displayDeciderName(undefined)).toBeNull();
    expect(displayDeciderName("")).toBeNull();
    expect(displayDeciderName("   ")).toBeNull();
  });
  it("returns null for a value containing @", () => {
    expect(displayDeciderName("someone@example.com")).toBeNull();
  });
  it("returns an ordinary name trimmed", () => {
    expect(displayDeciderName("  Pat Example ")).toBe("Pat Example");
  });
});

describe("describeApprovalConflict", () => {
  it("approved by someone else (approve verb offers the co-sign)", () => {
    const text = describeApprovalConflict(base, "disbursement");
    expect(text).toBe("Pat Example already approved this disbursement. You can add your approval too.");
    expect(text).not.toContain("Only one approval is needed");
    expect(describeApprovalConflict(base, "disbursement", "approve")).toBe(text);
  });
  it("approved by someone else (reject verb has no suffix)", () => {
    expect(describeApprovalConflict(base, "sweep", "reject")).toBe("Pat Example already approved this sweep.");
  });
  it("the viewer's own approval and the rejected rows ignore the verb", () => {
    for (const verb of ["approve", "reject"] as const) {
      expect(describeApprovalConflict({ ...base, decidedByViewer: true }, "sweep", verb)).toBe(
        "You already approved this sweep.",
      );
      expect(describeApprovalConflict({ ...base, decision: "rejected" }, "sweep", verb)).toBe(
        "Pat Example already rejected this sweep.",
      );
    }
  });
  it("approved by the viewer", () => {
    expect(describeApprovalConflict({ ...base, decidedByViewer: true }, "sweep")).toBe(
      "You already approved this sweep.",
    );
  });
  it("rejected", () => {
    expect(describeApprovalConflict({ ...base, decision: "rejected" }, "transfer")).toBe(
      "Pat Example already rejected this transfer.",
    );
    expect(describeApprovalConflict({ ...base, decision: "rejected", decidedByViewer: true }, "transfer")).toBe(
      "You already rejected this transfer.",
    );
  });
  it("no decision", () => {
    expect(describeApprovalConflict({ ...base, decision: null, deciderName: null }, "disbursement")).toBe(
      "This disbursement is no longer waiting for approval.",
    );
  });
  it("a null name reads A board member", () => {
    expect(describeApprovalConflict({ ...base, deciderName: null }, "disbursement")).toBe(
      "A board member already approved this disbursement. You can add your approval too.",
    );
  });
  it("never outputs an @", () => {
    const outs = [
      describeApprovalConflict({ ...base, deciderName: "a@example.com" }, "disbursement"),
      describeApprovalConflict({ ...base, decision: "rejected", deciderName: "a@example.com" }, "sweep"),
      describeApprovalConflict({ ...base, decision: null, deciderName: "a@example.com" }, "transfer"),
    ];
    for (const o of outs) expect(o).not.toContain("@");
    expect(outs[0]).toContain("A board member");
  });
});

describe("isApprovalConflict", () => {
  it("accepts a full body", () => {
    expect(isApprovalConflict(base)).toBe(true);
  });
  it("rejects missing code, different code, or non-object", () => {
    expect(isApprovalConflict({ error: "x" })).toBe(false);
    expect(isApprovalConflict({ error: "x", code: "not_found" })).toBe(false);
    expect(isApprovalConflict({ code: "not_pending" })).toBe(false);
    expect(isApprovalConflict(null)).toBe(false);
    expect(isApprovalConflict("not_pending")).toBe(false);
  });
});

describe("describeApprovalConflict (rejected by the viewer)", () => {
  it("reads 'You already rejected' when the viewer rejected it", () => {
    expect(
      describeApprovalConflict({ ...base, decision: "rejected", decidedByViewer: true }, "sweep"),
    ).toBe("You already rejected this sweep.");
  });
  it("names another rejector otherwise", () => {
    expect(describeApprovalConflict({ ...base, decision: "rejected" }, "transfer")).toBe(
      "Pat Example already rejected this transfer.",
    );
  });
});

describe("describeApprovalFund with entity names", () => {
  const sweep = {
    fundName: "Charitable Fund",
    partnerFundName: "Activity Fund",
    entityId: "e1",
    partnerEntityId: "e2",
  };
  it("names both books on a Sweep", () => {
    expect(
      describeApprovalFund({ ...sweep, entityName: "Foundation", partnerEntityName: "Club" }).text,
    ).toBe("Charitable Fund (Foundation) → Activity Fund (Club)");
  });
  it("leaves the text byte-identical when names are absent", () => {
    expect(describeApprovalFund(sweep).text).toBe("Charitable Fund → Activity Fund");
    expect(describeApprovalFund({ ...sweep, entityName: "Foundation" }).text).toBe(
      "Charitable Fund → Activity Fund",
    );
  });
  it("does not decorate a same-entity Transfer", () => {
    expect(
      describeApprovalFund({
        fundName: "A", partnerFundName: "B", entityId: "e1", partnerEntityId: "e1",
        entityName: "Club", partnerEntityName: "Club",
      }).text,
    ).toBe("A → B");
  });
});

describe("parseApprovalTab", () => {
  it("whitelists the tab", () => {
    expect(parseApprovalTab("decided")).toBe("decided");
    expect(parseApprovalTab("pending")).toBe("pending");
    expect(parseApprovalTab("bogus")).toBe("pending");
    expect(parseApprovalTab(undefined)).toBe("pending");
    expect(parseApprovalTab(["decided"])).toBe("pending");
    expect(APPROVAL_TABS).toEqual(["pending", "decided"]);
    expect(RECENT_DECISIONS_LIMIT).toBe(25);
  });
});

describe("formatDecisionDateTime", () => {
  it("renders the Eastern evening, not the UTC date", () => {
    expect(formatDecisionDateTime("2026-10-11T01:30:00.000Z")).toBe("Oct 10, 2026 at 9:30 PM");
  });
  it("uses EST in winter and EDT in summer (each side of a DST change)", () => {
    expect(formatDecisionDateTime(new Date("2026-03-08T06:59:00.000Z"))).toBe("Mar 8, 2026 at 1:59 AM");
    expect(formatDecisionDateTime(new Date("2026-03-08T07:01:00.000Z"))).toBe("Mar 8, 2026 at 3:01 AM");
  });
  it("returns an empty string for garbage", () => {
    expect(formatDecisionDateTime("nope")).toBe("");
  });
});

describe("formatApprovalDollars", () => {
  it("formats with separators", () => {
    expect(formatApprovalDollars(2275)).toBe("$22.75");
    expect(formatApprovalDollars(227500)).toBe("$2,275.00");
    expect(formatApprovalDollars(123456700)).toBe("$1,234,567.00");
    expect(formatApprovalDollars(0)).toBe("$0.00");
    expect(formatApprovalDollars(5)).toBe("$0.05");
    expect(formatApprovalDollars(-250)).toBe("-$2.50");
  });
});

describe("approvalNounLabel / describePendingCount", () => {
  it("labels each kind", () => {
    expect(approvalNounLabel("disbursement")).toBe("Disbursement");
    expect(approvalNounLabel("transfer")).toBe("Transfer");
    expect(approvalNounLabel("sweep")).toBe("Sweep");
  });
  it("pluralizes the count line", () => {
    expect(describePendingCount(1)).toBe("1 item awaiting approval");
    expect(describePendingCount(3)).toBe("3 items awaiting approval");
    expect(describePendingCount(0)).toBe("0 items awaiting approval");
  });
});

describe("buildApprovalBanner", () => {
  const decidedBase = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "disbursement" as const,
    decidedAt: "2026-10-10T19:42:00.000Z",
    deciderName: "Pat Example" as string | null,
    deciderIsViewer: false,
    amountCents: 227500,
    txnDate: "2026-10-09",
    party: "Acme Hall" as string | null,
    memo: null,
    fundName: "Admin Fund",
    partnerFundName: null,
    entityId: "e1",
    partnerEntityId: null,
    entityName: "Club",
    partnerEntityName: null,
    recorderName: null,
  };
  const approved = (o: Partial<DecidedApprovalRow> = {}): ApprovalTargetState => ({
    state: "decided",
    row: {
      ...decidedBase,
      decision: "approved",
      boardMinute: "Sep minutes",
      cosigners: [],
      canCosign: true,
      viewerHasCosigned: false,
      viewerRecorded: false,
      ...o,
    } as DecidedApprovalRow,
  });
  const rejected = (o: Record<string, unknown> = {}): ApprovalTargetState => ({
    state: "decided",
    row: {
      ...decidedBase, decision: "rejected", deciderOnFile: true, rejectionReason: "Too high", ...o,
    } as DecidedApprovalRow,
  });
  const link = `/admin/ledger/approvals?tab=decided&txn=${decidedBase.id}`;
  const cs = (name: string | null): CosignerView => ({
    name,
    cosignedAt: "2026-10-10T20:00:00.000Z",
    isViewer: false,
  });

  it("pending, not own and own", () => {
    expect(buildApprovalBanner({ state: "pending", rowId: "x", kind: "sweep", isOwn: false })).toEqual({
      tone: "info",
      text: "This is the sweep from your email. It is waiting for a board decision.",
    });
    expect(buildApprovalBanner({ state: "pending", rowId: "x", kind: "transfer", isOwn: true })).toEqual({
      tone: "info",
      text: "You recorded this transfer, so another board member needs to decide it.",
    });
  });
  it("approved, eligible, no co-signs", () => {
    const b = buildApprovalBanner(approved());
    expect(b.tone).toBe("success");
    expect(b.text).toBe(
      "Approved by Pat Example on Oct 10, 2026 at 3:42 PM. It has been posted. You can add your approval too.",
    );
    expect(b.action).toBe("cosign");
    expect(b.linkHref).toBe(link);
    expect(b.linkLabel).toBe("See it under Recently decided");
  });
  it("approved with no name reads A board member", () => {
    expect(buildApprovalBanner(approved({ deciderName: null })).text).toContain("Approved by A board member on");
  });
  it("approved, eligible, with co-signs", () => {
    const b = buildApprovalBanner(approved({ cosigners: [cs("Ann Example"), cs("Bo Example")] }));
    expect(b.text).toBe(
      "Approved by Pat Example on Oct 10, 2026 at 3:42 PM. Also approved by Ann Example and Bo Example. You can add your approval too.",
    );
    expect(b.action).toBe("cosign");
  });
  it("approved, eligible, with more than three co-signers links to everyone", () => {
    const b = buildApprovalBanner(
      approved({ cosigners: ["A", "B", "C", "D", "E", "F", "G"].map((n) => cs(`${n} Example`)) }),
    );
    expect(b.text).toContain("Also approved by A Example, B Example, C Example and 4 others.");
    expect(b.linkLabel).toBe("See everyone under Recently decided");
    expect(b.linkHref).toBe(link);
    expect(b.action).toBe("cosign");
  });
  it("I am the posting approver", () => {
    const b = buildApprovalBanner(approved({ deciderIsViewer: true, canCosign: false }));
    expect(b.text).toBe("You approved this $2,275.00 disbursement to Acme Hall on Oct 10, 2026 at 3:42 PM.");
    expect(b.action).toBeUndefined();
    expect(b.linkHref).toBe(link);
    expect(
      buildApprovalBanner(approved({ deciderIsViewer: true, canCosign: false, cosigners: [cs("Ann Example")] })).text,
    ).toBe(
      "You approved this $2,275.00 disbursement to Acme Hall on Oct 10, 2026 at 3:42 PM. Also approved by Ann Example.",
    );
  });
  it("I added my approval (others exclude me)", () => {
    const b = buildApprovalBanner(
      approved({
        canCosign: false,
        viewerHasCosigned: true,
        cosigners: [cs("Ann Example"), { name: "Viewer Example", cosignedAt: "2026-10-11T01:30:00.000Z", isViewer: true }],
      }),
    );
    expect(b.text).toBe(
      "You added your approval on Oct 10, 2026 at 9:30 PM. Approved by Pat Example on Oct 10, 2026 at 3:42 PM. Also approved by Ann Example.",
    );
    expect(b.action).toBeUndefined();
    expect(
      buildApprovalBanner(
        approved({
          canCosign: false,
          viewerHasCosigned: true,
          cosigners: [{ name: null, cosignedAt: "2026-10-11T01:30:00.000Z", isViewer: true }],
        }),
      ).text,
    ).toBe("You added your approval on Oct 10, 2026 at 9:30 PM. Approved by Pat Example on Oct 10, 2026 at 3:42 PM.");
  });
  it("I recorded it", () => {
    const b = buildApprovalBanner(
      approved({ canCosign: false, viewerRecorded: true, cosigners: [cs("Ann Example")] }),
    );
    expect(b.tone).toBe("neutral");
    expect(b.text).toBe(
      "You recorded this disbursement, so another board member decides it. Approved by Pat Example on Oct 10, 2026 at 3:42 PM. Also approved by Ann Example.",
    );
    expect(b.action).toBeUndefined();
  });
  it("precedence is recorded > poster > cosigned > eligible", () => {
    const all = { deciderIsViewer: true, viewerHasCosigned: true, viewerRecorded: true, canCosign: true };
    expect(buildApprovalBanner(approved(all)).text).toContain("You recorded this");
    expect(buildApprovalBanner(approved({ ...all, viewerRecorded: false })).text).toContain("You approved this");
    expect(buildApprovalBanner(approved({ ...all, viewerRecorded: false, deciderIsViewer: false })).text).toContain(
      "You added your approval",
    );
    // cosign action only on the two eligible rows, never beside a higher-precedence row
    expect(buildApprovalBanner(approved(all)).action).toBeUndefined();
    expect(buildApprovalBanner(approved({ ...all, viewerRecorded: false })).action).toBeUndefined();
  });
  it("an eligible viewer who cannot co-sign gets no button", () => {
    expect(buildApprovalBanner(approved({ canCosign: false })).action).toBeUndefined();
  });
  it("transfer and sweep wording carry no payee", () => {
    expect(buildApprovalBanner(approved({ kind: "sweep", deciderIsViewer: true, canCosign: false })).text).toBe(
      "You approved this $2,275.00 sweep on Oct 10, 2026 at 3:42 PM.",
    );
    expect(buildApprovalBanner(approved({ kind: "transfer", deciderIsViewer: true, canCosign: false })).text).toBe(
      "You approved this $2,275.00 transfer on Oct 10, 2026 at 3:42 PM.",
    );
  });
  it("disbursement without a payee omits 'to'", () => {
    expect(buildApprovalBanner(approved({ party: null, deciderIsViewer: true, canCosign: false })).text).toBe(
      "You approved this $2,275.00 disbursement on Oct 10, 2026 at 3:42 PM.",
    );
  });
  it("never says 'Only one approval is needed', a fraction of the board, or votes", () => {
    const states = [
      approved(),
      approved({ cosigners: [cs("A"), cs("B"), cs("C"), cs("D")] }),
      approved({ deciderIsViewer: true, canCosign: false }),
      approved({ canCosign: false, viewerHasCosigned: true, cosigners: [{ name: null, cosignedAt: "2026-10-11T01:30:00.000Z", isViewer: true }] }),
      approved({ canCosign: false, viewerRecorded: true }),
    ];
    for (const s of states) {
      const t = buildApprovalBanner(s).text;
      expect(t).not.toMatch(/only one approval|\bof \d+\b|votes?\b|nothing more to do/i);
    }
  });
  it("rejected by someone else, by the viewer, and legacy", () => {
    const other = buildApprovalBanner(rejected());
    expect(other.tone).toBe("neutral");
    expect(other.text).toBe(
      "Rejected. Pat Example rejected this $2,275.00 disbursement on Oct 10, 2026 at 3:42 PM. Reason: Too high.",
    );
    expect(other.linkHref).toBe(link);
    expect(buildApprovalBanner(rejected({ deciderIsViewer: true })).text).toBe(
      "You rejected this $2,275.00 disbursement on Oct 10, 2026 at 3:42 PM. Reason: Too high.",
    );
    expect(buildApprovalBanner(rejected({ deciderOnFile: false, deciderName: null })).text).toBe(
      "This disbursement was rejected on Oct 10, 2026 at 3:42 PM. Reason: Too high.",
    );
  });
  it("does not double the period when the reason already ends in punctuation", () => {
    for (const [reason, tail] of [
      ["Too high.", "Reason: Too high."],
      ["Over budget!", "Reason: Over budget!"],
      ["Why so much?", "Reason: Why so much?"],
      ["  Too high  ", "Reason: Too high."],
    ] as const) {
      const text = buildApprovalBanner(rejected({ rejectionReason: reason })).text;
      expect(text.endsWith(tail)).toBe(true);
      expect(text).not.toMatch(/[.!?]\./);
    }
    expect(buildApprovalBanner(rejected({ rejectionReason: null })).text).not.toContain("Reason");
  });
  it("posted with no board decision, and not found, have no link", () => {
    const n = buildApprovalBanner({ state: "not_board_decision", kind: "disbursement" });
    expect(n.text).toBe("This entry did not need board approval, so there is nothing for you to do.");
    expect(n.linkHref).toBeUndefined();
    const f = buildApprovalBanner({ state: "not_found" });
    expect(f.text).toBe("We can't find that disbursement. It may have been deleted after it was recorded.");
    expect(f.linkHref).toBeUndefined();
  });
  it("no output contains an @", () => {
    const states: ApprovalTargetState[] = [
      { state: "not_found" },
      { state: "pending", rowId: "x", kind: "sweep", isOwn: false },
      { state: "not_board_decision", kind: "sweep" },
      approved(), approved({ deciderIsViewer: true }), rejected(), rejected({ deciderOnFile: false }),
      approved({ cosigners: [cs("Ann Example"), { name: "x@example.com", cosignedAt: "2026-10-11T01:30:00.000Z", isViewer: false }] }),
      approved({ canCosign: false, viewerRecorded: true, cosigners: [cs("Ann Example")] }),
    ];
    for (const s of states) expect(JSON.stringify(buildApprovalBanner(s))).not.toContain("@");
  });
});

describe("cosignEligibility", () => {
  const V = "v";
  const input = (o: Partial<Parameters<typeof cosignEligibility>[0]> = {}) => ({
    viewerId: V,
    recorderIds: ["r1"] as (string | null)[],
    approvedByUserId: "poster" as string | null,
    cosignerUserIds: [] as (string | null)[],
    ...o,
  });
  it("is eligible for a stranger", () => {
    expect(cosignEligibility(input())).toEqual({ ok: true });
  });
  it("refuses the recorder of either leg", () => {
    expect(cosignEligibility(input({ recorderIds: [V, "r2"] }))).toEqual({ ok: false, reason: "recorded_by_you" });
    expect(cosignEligibility(input({ recorderIds: ["r1", V] }))).toEqual({ ok: false, reason: "recorded_by_you" });
    expect(cosignEligibility(input({ recorderIds: [V] }))).toEqual({ ok: false, reason: "recorded_by_you" });
  });
  it("refuses the poster", () => {
    expect(cosignEligibility(input({ approvedByUserId: V }))).toEqual({ ok: false, reason: "already_approved" });
  });
  it("refuses an existing co-signer", () => {
    expect(cosignEligibility(input({ cosignerUserIds: ["x", V] }))).toEqual({ ok: false, reason: "already_cosigned" });
  });
  it("a deleted poster (null) is eligible for any viewer", () => {
    expect(cosignEligibility(input({ approvedByUserId: null }))).toEqual({ ok: true });
  });
  it("null entries never match the viewer", () => {
    expect(cosignEligibility(input({ recorderIds: [null, null], cosignerUserIds: [null, null] }))).toEqual({ ok: true });
  });
  it("precedence: recorder over poster over co-signer", () => {
    expect(
      cosignEligibility(input({ recorderIds: [V], approvedByUserId: V, cosignerUserIds: [V] })),
    ).toEqual({ ok: false, reason: "recorded_by_you" });
    expect(cosignEligibility(input({ approvedByUserId: V, cosignerUserIds: [V] }))).toEqual({
      ok: false,
      reason: "already_approved",
    });
  });
});

describe("isCosignConflict / isCosignForbidden", () => {
  it.each(["not_approved", "rejected", "not_board_decision", "already_approved", "already_cosigned"])(
    "accepts %s",
    (code) => {
      expect(isCosignConflict({ error: "x", code, at: null, deciderName: null })).toBe(true);
    },
  );
  it("rejects not_pending, a missing code, a missing error and non-objects", () => {
    expect(isCosignConflict({ error: "x", code: "not_pending" })).toBe(false);
    expect(isCosignConflict({ error: "x" })).toBe(false);
    expect(isCosignConflict({ code: "rejected" })).toBe(false);
    for (const v of [null, undefined, "x", 3, []]) expect(isCosignConflict(v)).toBe(false);
  });
  it("isCosignForbidden accepts only recorded_by_you", () => {
    expect(isCosignForbidden({ error: "x", code: "recorded_by_you" })).toBe(true);
    expect(isCosignForbidden({ error: "Forbidden" })).toBe(false);
    expect(isCosignForbidden({ error: "x", code: "rejected" })).toBe(false);
    expect(isCosignForbidden(null)).toBe(false);
  });
});

describe("formatApproverList", () => {
  const n = (name: string | null, isViewer = false) => ({ name, isViewer });
  it("one, two, three", () => {
    expect(formatApproverList([n("Ann")])).toEqual({ text: "Ann", hiddenCount: 0 });
    expect(formatApproverList([n("Ann"), n("Bo")]).text).toBe("Ann and Bo");
    expect(formatApproverList([n("Ann"), n("Bo"), n("Cy")]).text).toBe("Ann, Bo and Cy");
  });
  it("four or more with max 3 hides the rest", () => {
    const r = formatApproverList([n("Ann"), n("Bo"), n("Cy"), n("Di"), n("Ed")], { max: 3 });
    expect(r).toEqual({ text: "Ann, Bo, Cy and 2 others", hiddenCount: 2 });
    expect(formatApproverList([n("Ann"), n("Bo"), n("Cy"), n("Di")], { max: 3 })).toEqual({
      text: "Ann, Bo, Cy and 1 other",
      hiddenCount: 1,
    });
  });
  it("no max shows everyone", () => {
    const names = Array.from({ length: 13 }, (_, i) => n(`P${i}`));
    const r = formatApproverList(names);
    expect(r.hiddenCount).toBe(0);
    expect(r.text.endsWith(" and P12")).toBe(true);
  });
  it("the viewer reads You", () => {
    expect(formatApproverList([n("Ann"), n("Viewer Name", true)]).text).toBe("Ann and You");
  });
  it("unnamed collapse to one trailing item", () => {
    expect(formatApproverList([n(null)]).text).toBe("a board member");
    expect(formatApproverList([n(null), n(null), n(null)]).text).toBe("3 board members");
    expect(formatApproverList([n(null), n("Ann")]).text).toBe("Ann and a board member");
    expect(formatApproverList([n("Ann"), n(null), n("Bo"), n(null)]).text).toBe("Ann, Bo and 2 other board members");
  });
  it("an email-shaped name is treated as unnamed and an empty list is empty", () => {
    expect(formatApproverList([n("x@example.com")]).text).toBe("a board member");
    expect(formatApproverList([])).toEqual({ text: "", hiddenCount: 0 });
  });
  it("never contains an @, a fraction or votes", () => {
    const t = formatApproverList([n("a@example.com"), n("Ann"), n(null), n("Bo"), n("Cy")], { max: 3 }).text;
    expect(t).not.toMatch(/@|\bof \d+\b|vote/i);
  });
});
