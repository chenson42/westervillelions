/** T8-T10 and C9-C13: reason normalizer, move-body parser, audit payload shapes, copy. */
import { describe, it, expect } from "vitest";
import {
  CROSS_ENTITY_STATE_COPY,
  TRANSACTION_DELETED_AUDIT_ACTION,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  buildMoveWarnings,
  buildSweepMemo,
  formatStatementMonth,
  sentStatementWarning,
  isRawAudit,
  normalizeCorrectionReason,
  parseAuditAfter,
  parseAuditBefore,
  parseAuditDetails,
  parseDeleteBody,
  parseMoveBody,
  serializeAuditPayload,
  type FundMoveAuditPayload,
  type FundMoveAuditPayloadV2,
  type TransactionDeletedAuditPayload,
} from "./ledger-correction";

describe("normalizeCorrectionReason (T8)", () => {
  it("rejects non-strings, empty and whitespace-only", () => {
    for (const v of [undefined, null, 5, {}, "", "   ", "\n\t "]) {
      expect(normalizeCorrectionReason(v).ok).toBe(false);
    }
  });

  it("counts the trimmed length: 9 fails, 10 passes, 500 passes, 501 fails", () => {
    expect(normalizeCorrectionReason("a".repeat(9)).ok).toBe(false);
    expect(normalizeCorrectionReason("a".repeat(10)).ok).toBe(true);
    expect(normalizeCorrectionReason("a".repeat(500)).ok).toBe(true);
    expect(normalizeCorrectionReason("a".repeat(501)).ok).toBe(false);
  });

  it("trims outer whitespace but preserves interior whitespace", () => {
    const r = normalizeCorrectionReason("   booked  to the\twrong fund   ");
    expect(r).toEqual({ ok: true, value: "booked  to the\twrong fund" });
  });

  it("padding does not satisfy the minimum", () => {
    expect(normalizeCorrectionReason("   short   ").ok).toBe(false);
  });

  it("counts by code point: emoji and RTL text", () => {
    // 10 emoji are 10 code points (20 UTF-16 units): passes at the minimum.
    expect(normalizeCorrectionReason("\u{1F600}".repeat(10)).ok).toBe(true);
    expect(normalizeCorrectionReason("\u{1F600}".repeat(9)).ok).toBe(false);
    // 500 emoji is exactly the cap; 501 is over.
    expect(normalizeCorrectionReason("\u{1F600}".repeat(500)).ok).toBe(true);
    expect(normalizeCorrectionReason("\u{1F600}".repeat(501)).ok).toBe(false);
    // Hebrew (RTL) text is accepted.
    expect(normalizeCorrectionReason("שלום עולם hello").ok).toBe(true);
  });
});

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const GOOD = {
  destFundId: U1,
  categoryId: U2,
  reason: "Zeffy gift booked to the wrong fund",
  expectedFundId: U3,
};

describe("parseMoveBody (T9)", () => {
  it("accepts the four required keys; an absent destBankAccountId is normalized to null (C10)", () => {
    expect(parseMoveBody(GOOD)).toEqual({ ok: true, value: { ...GOOD, destBankAccountId: null } });
  });

  it("C10: destBankAccountId null and a string pass through; the value is not shape-checked here", () => {
    expect(parseMoveBody({ ...GOOD, destBankAccountId: null })).toEqual({
      ok: true,
      value: { ...GOOD, destBankAccountId: null },
    });
    expect(parseMoveBody({ ...GOOD, destBankAccountId: U1 })).toEqual({
      ok: true,
      value: { ...GOOD, destBankAccountId: U1 },
    });
    // A malformed or empty string is the query layer's decision (it depends on the destination).
    expect(parseMoveBody({ ...GOOD, destBankAccountId: "" }).ok).toBe(true);
    expect(parseMoveBody({ ...GOOD, destBankAccountId: "nope" }).ok).toBe(true);
  });

  it("C10: a number, object, array or boolean destBankAccountId is rejected, and unknown keys still are", () => {
    for (const v of [5, {}, [], true, false]) {
      expect(parseMoveBody({ ...GOOD, destBankAccountId: v }).ok).toBe(false);
    }
    expect(parseMoveBody({ ...GOOD, destBankAccountId: U1, bankAccountId: U1 }).ok).toBe(false);
    const ok = parseMoveBody({ ...GOOD, destBankAccountId: U1 });
    expect(ok.ok && Object.keys(ok.value).sort()).toEqual([
      "categoryId",
      "destBankAccountId",
      "destFundId",
      "expectedFundId",
      "reason",
    ]);
  });

  it("accepts categoryId null but rejects the empty string", () => {
    expect(parseMoveBody({ ...GOOD, categoryId: null }).ok).toBe(true);
    expect(parseMoveBody({ ...GOOD, categoryId: "" }).ok).toBe(false);
  });

  it("rejects an extra key, a missing key, and non-object bodies", () => {
    expect(parseMoveBody({ ...GOOD, memo: "x" }).ok).toBe(false);
    expect(parseMoveBody({ ...GOOD, fundId: U1 }).ok).toBe(false);
    for (const k of Object.keys(GOOD)) {
      const copy: Record<string, unknown> = { ...GOOD };
      delete copy[k];
      expect(parseMoveBody(copy).ok).toBe(false);
    }
    for (const b of [null, undefined, "x", 5, []]) expect(parseMoveBody(b).ok).toBe(false);
  });

  it("rejects non-uuid ids", () => {
    expect(parseMoveBody({ ...GOOD, destFundId: "fund-1" }).ok).toBe(false);
    expect(parseMoveBody({ ...GOOD, expectedFundId: 5 }).ok).toBe(false);
    expect(parseMoveBody({ ...GOOD, categoryId: "cat" }).ok).toBe(false);
  });

  it("returns the TRIMMED reason and rejects a bad one", () => {
    const r = parseMoveBody({ ...GOOD, reason: "   Zeffy gift booked wrongly   " });
    expect(r.ok && r.value.reason).toBe("Zeffy gift booked wrongly");
    expect(parseMoveBody({ ...GOOD, reason: "short" }).ok).toBe(false);
  });
});

describe("parseDeleteBody", () => {
  it("requires a body with a valid reason", () => {
    expect(parseDeleteBody(null).ok).toBe(false);
    expect(parseDeleteBody({}).ok).toBe(false);
    expect(parseDeleteBody({ reason: "short" }).ok).toBe(false);
    expect(parseDeleteBody({ reason: "  duplicate entry of the same gift  " })).toEqual({
      ok: true,
      value: { reason: "duplicate entry of the same gift" },
    });
  });
});

const MOVE: FundMoveAuditPayload = {
  before: {
    v: 1,
    fund: { id: "f1", name: "Administrative Fund", slug: "administrative", kind: "administrative" },
    category: { id: "c1", name: "Donations" },
    budgetLineId: null,
  },
  after: {
    v: 1,
    fund: { id: "f2", name: "Activity Fund", slug: "activity", kind: "activity" },
    category: { id: "c2", name: "Public donations" },
    budgetLineId: null,
  },
  details: {
    v: 1,
    reason: "Booked to the wrong fund",
    entityId: "e1",
    txnDate: "2026-09-15",
    flow: "income",
    amountCents: 12500,
    fiscalYear: 2026,
    tier: "record",
    reconciled: false,
    reconciledSessionId: null,
    priorFiscalYear: false,
    sentStatementMonth: null,
  },
};

const DELETED: TransactionDeletedAuditPayload = {
  before: {
    v: 1,
    rows: [
      {
        id: "t1",
        entityId: "e1",
        fund: { id: "f1", name: "Administrative Fund", slug: "administrative", kind: "administrative" },
        bankAccount: { id: "b1", name: "Checking" },
        category: null,
        txnDate: "2026-09-15",
        flow: "income",
        amountCents: 12500,
        party: "Example Donor",
        memo: null,
        donorId: null,
        checkNumber: null,
        paymentMethod: "check",
        status: "posted",
        reconciled: false,
        reconciledSessionId: null,
        duesPaymentId: null,
        transferGroupId: null,
        budgetLineId: null,
        acknowledgment: { existed: false, sent: false },
      },
    ],
  },
  after: null,
  details: {
    v: 1,
    reason: "Duplicate entry",
    entityId: "e1",
    txnDate: "2026-09-15",
    flow: "income",
    amountCents: 12500,
    fiscalYear: 2026,
    rowCount: 1,
    reconciled: false,
    reconciledSessionId: null,
    priorFiscalYear: false,
    sentStatementMonth: null,
    acknowledgmentRemoved: false,
  },
};

describe("audit payloads (T10)", () => {
  it("serialize to v:1 JSON text and round-trip through the parsers", () => {
    const text = serializeAuditPayload(MOVE);
    expect(JSON.parse(text.before!).v).toBe(1);
    expect(JSON.parse(text.after!).v).toBe(1);
    expect(JSON.parse(text.details).v).toBe(1);
    expect(parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, text.before)).toEqual(MOVE.before);
    expect(parseAuditAfter(text.after)).toEqual(MOVE.after);
    expect(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, text.details)).toEqual(MOVE.details);
  });

  it("a delete serializes after as null and round-trips its snapshot rows", () => {
    const text = serializeAuditPayload(DELETED);
    expect(text.after).toBeNull();
    expect(parseAuditBefore(TRANSACTION_DELETED_AUDIT_ACTION, text.before)).toEqual(DELETED.before);
    expect(parseAuditDetails(TRANSACTION_DELETED_AUDIT_ACTION, text.details)).toEqual(DELETED.details);
  });

  it("legacy plain text, malformed JSON, an unknown version and null degrade to { raw } without throwing", () => {
    const inputs: Array<string | null | undefined> = [
      "Reconciled-lock carve-out: transaction was cleared by session s1.",
      "{not json",
      JSON.stringify({ v: 2, reason: "x", entityId: "e" }),
      JSON.stringify({ v: 3, reason: "x", entityId: "e", destEntityId: "d", acknowledgment: {} }),
      JSON.stringify([1, 2]),
      JSON.stringify({ v: 1 }),
      null,
      undefined,
    ];
    for (const input of inputs) {
      expect(isRawAudit(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, input))).toBe(true);
      expect(isRawAudit(parseAuditDetails(TRANSACTION_DELETED_AUDIT_ACTION, input))).toBe(true);
      expect(isRawAudit(parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, input))).toBe(true);
      expect(isRawAudit(parseAuditBefore(TRANSACTION_DELETED_AUDIT_ACTION, input))).toBe(true);
      expect(isRawAudit(parseAuditAfter(input))).toBe(true);
    }
  });
});

describe("warning copy", () => {
  it("formats statement months", () => {
    expect(formatStatementMonth("2026-09")).toBe("September 2026");
    expect(formatStatementMonth("garbage")).toBe("garbage");
  });

  it("buildMoveWarnings composes the right set", () => {
    const codes = (w: ReturnType<typeof buildMoveWarnings>) => w.map((x) => x.code);
    expect(
      codes(
        buildMoveWarnings({
          anyDestinationAllowed: true,
          tierReasons: ["reconciled", "prior_fiscal_year"],
          sentStatementMonth: "2026-09",
          aged: true,
          bankAccountName: "Checking",
        }),
      ),
    ).toEqual([
      "ratchet",
      "reconciled",
      "prior_fiscal_year",
      "sent_statement",
      "aged_public_fund",
      "sweep_not_automatic",
    ]);
    expect(
      codes(
        buildMoveWarnings({
          anyDestinationAllowed: false,
          tierReasons: [],
          sentStatementMonth: null,
          aged: true,
          bankAccountName: null,
        }),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C9, C11-C13
// ---------------------------------------------------------------------------

const MOVE_V2: FundMoveAuditPayloadV2 = {
  before: {
    v: 2,
    entity: { id: "e-foundation", name: "Foundation", slug: "foundation" },
    fund: { id: "f1", name: "Charitable Fund", slug: "charitable", kind: "charitable" },
    bankAccount: { id: "b1", name: "Foundation Checking" },
    category: { id: "c1", name: "Donations" },
    budgetLineId: null,
  },
  after: {
    v: 2,
    entity: { id: "e-club", name: "Club", slug: "club" },
    fund: { id: "f2", name: "Activity Fund", slug: "activity", kind: "activity" },
    bankAccount: { id: "b2", name: "Administrative Checking" },
    category: { id: "c2", name: "Public donations" },
    budgetLineId: null,
  },
  details: {
    v: 2,
    reason: "Deposited into the Club account",
    entityId: "e-foundation",
    destEntityId: "e-club",
    crossEntity: true,
    txnDate: "2026-09-15",
    flow: "income",
    amountCents: 25000,
    fiscalYear: 2026,
    tier: "manage",
    reconciled: false,
    reconciledSessionId: null,
    priorFiscalYear: false,
    sentStatementMonth: "2026-09",
    destSentStatementMonth: null,
    donorId: "donor-1",
    acknowledgment: {
      id: "ack-1",
      sent: true,
      sentAt: "2026-09-20T12:00:00.000Z",
      outcome: "kept",
      doneeEntityId: "e-foundation",
    },
  },
};

describe("CROSS_ENTITY_STATE_COPY (C9)", () => {
  it("has a message and a next step for every cross-entity state code, with the exact design copy", () => {
    expect(Object.keys(CROSS_ENTITY_STATE_COPY).sort()).toEqual([
      "matched_open_session",
      "prior_fiscal_year_cross_entity",
      "reconciled_legacy",
      "reconciled_session",
    ]);
    for (const copy of Object.values(CROSS_ENTITY_STATE_COPY)) {
      expect(copy.message.length).toBeGreaterThan(0);
      expect(copy.nextStep.length).toBeGreaterThan(0);
    }
    expect(CROSS_ENTITY_STATE_COPY.reconciled_legacy.nextStep).toBe("Un-mark it as reconciled first.");
    expect(CROSS_ENTITY_STATE_COPY.matched_open_session.nextStep).toBe("Unmatch it in the session first.");
  });
});

describe("audit v2 (C11)", () => {
  it("round-trips through serializeAuditPayload and each parser", () => {
    const text = serializeAuditPayload(MOVE_V2);
    expect(JSON.parse(text.before!).v).toBe(2);
    expect(JSON.parse(text.after!).v).toBe(2);
    expect(JSON.parse(text.details).v).toBe(2);
    expect(parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, text.before)).toEqual(MOVE_V2.before);
    expect(parseAuditAfter(text.after)).toEqual(MOVE_V2.after);
    expect(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, text.details)).toEqual(MOVE_V2.details);
  });

  it("v1 is unchanged: a v1 payload still parses to itself", () => {
    const text = serializeAuditPayload(MOVE);
    expect(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, text.details)).toEqual(MOVE.details);
  });

  it("v2 details without destEntityId or without acknowledgment, v2 before without entity, v2 after without bankAccount, v3 and a v2 DELETE are all { raw }", () => {
    const { destEntityId, ...noDest } = MOVE_V2.details;
    void destEntityId;
    const { acknowledgment, ...noAck } = MOVE_V2.details;
    void acknowledgment;
    expect(isRawAudit(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, JSON.stringify(noDest)))).toBe(true);
    expect(isRawAudit(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, JSON.stringify(noAck)))).toBe(true);

    const { entity, ...beforeNoEntity } = MOVE_V2.before;
    void entity;
    expect(isRawAudit(parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, JSON.stringify(beforeNoEntity)))).toBe(true);

    const { bankAccount, ...afterNoBank } = MOVE_V2.after;
    void bankAccount;
    expect(isRawAudit(parseAuditAfter(JSON.stringify(afterNoBank)))).toBe(true);

    const v3 = JSON.stringify({ ...MOVE_V2.details, v: 3 });
    expect(isRawAudit(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, v3))).toBe(true);

    // A v2 payload is never valid for the delete action.
    expect(isRawAudit(parseAuditDetails(TRANSACTION_DELETED_AUDIT_ACTION, JSON.stringify(MOVE_V2.details)))).toBe(true);
    expect(
      isRawAudit(parseAuditBefore(TRANSACTION_DELETED_AUDIT_ACTION, JSON.stringify({ v: 2, rows: [] }))),
    ).toBe(true);
  });

  it("hostile inputs never throw and degrade to { raw }", () => {
    const hostile: Array<string | null | undefined> = [
      "",
      "null",
      "[]",
      "0",
      '"string"',
      "true",
      "{",
      '{"v":2}',
      '{"v":2,"reason":5,"entityId":"e","destEntityId":"d","acknowledgment":{}}',
      '{"v":2,"reason":"r","entityId":"e","destEntityId":"d","acknowledgment":null}',
      '{"v":2,"reason":"r","entityId":"e","destEntityId":"d","acknowledgment":[]}',
      '{"v":"2","reason":"r","entityId":"e"}',
      '{"v":2,"fund":null,"entity":{}}',
      '{"v":2,"fund":{},"entity":"x"}',
      '{"v":-1}',
      null,
      undefined,
    ];
    for (const input of hostile) {
      expect(() => parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, input)).not.toThrow();
      expect(() => parseAuditBefore(TRANSACTION_FUND_MOVED_AUDIT_ACTION, input)).not.toThrow();
      expect(() => parseAuditAfter(input)).not.toThrow();
      expect(isRawAudit(parseAuditDetails(TRANSACTION_FUND_MOVED_AUDIT_ACTION, input))).toBe(true);
      expect(isRawAudit(parseAuditAfter(input))).toBe(true);
    }
  });
});

describe("buildMoveWarnings (C12)", () => {
  const codes = (w: ReturnType<typeof buildMoveWarnings>) => w.map((x) => x.code);
  const X: {
    receipt: "none" | "unsent" | "sent";
    sourceLabel: string;
    destLabel: string;
    destSentStatementMonth: string | null;
    duplicateCount: number;
    fiscalYear: number;
  } = {
    receipt: "sent",
    sourceLabel: "Foundation",
    destLabel: "Club",
    destSentStatementMonth: null,
    duplicateCount: 0,
    fiscalYear: 2026,
  };
  function cross(over: Partial<typeof X> = {}, top: { sent?: string | null; aged?: boolean } = {}) {
    return buildMoveWarnings({
      anyDestinationAllowed: true,
      tierReasons: [],
      sentStatementMonth: top.sent ?? null,
      aged: top.aged ?? false,
      bankAccountName: "Foundation Checking",
      crossEntity: { ...X, ...over },
    });
  }

  it("same-entity output is byte-identical to the shipped copy", () => {
    const w = buildMoveWarnings({
      anyDestinationAllowed: true,
      tierReasons: ["reconciled", "prior_fiscal_year"],
      sentStatementMonth: "2026-09",
      aged: true,
      bankAccountName: "Administrative Checking",
    });
    expect(w).toEqual([
      {
        code: "ratchet",
        message:
          "This cannot be moved back. Money in the Activity Fund can only leave through a minuted sweep to the Foundation. If you move the wrong entry, the fix is to delete and re-enter it, or to reopen its reconciliation session first if it has been reconciled.",
      },
      {
        code: "reconciled",
        message:
          "This entry was cleared on a bank statement. Moving it changes only the fund; the bank balance and the reconciliation are not affected.",
      },
      {
        code: "prior_fiscal_year",
        message: "This entry is dated in an earlier fiscal year. Moving it restates that year's fund totals.",
      },
      {
        code: "sent_statement",
        message:
          "The Administrative statement for September 2026 was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically.",
      },
      {
        code: "aged_public_fund",
        message:
          "This entry is older than the holding period, so the Activity Fund will show the aged-funds warning until it is swept.",
      },
      {
        code: "sweep_not_automatic",
        message:
          "Moving does not sweep anything. The cash is still in Administrative Checking; record the sweep separately once the money has actually been moved.",
      },
    ]);
  });

  it("cross-entity with a sent receipt: ratchet names the receipt, receipt_sent, reports_change, reconciliation_pending, sweep (in order)", () => {
    const w = cross();
    expect(codes(w)).toEqual(["ratchet", "receipt_sent", "reports_change", "reconciliation_pending", "sweep_not_automatic"]);
    expect(w[0].message).toBe(
      "This cannot be moved back. The Club's Activity Fund can only send money to the Foundation through a minuted sweep, and because a receipt has already gone to the donor, this entry can no longer be deleted; correcting it later means a refund entry.",
    );
    expect(w[1].message).toContain("still names the Foundation as the issuer");
    expect(w[1].message).toContain("whoever advises the club on tax matters");
  });

  it("cross-entity without a receipt drops the deletion sentence; an unsent receipt adds unsent_receipt_removed", () => {
    const none = cross({ receipt: "none" });
    expect(codes(none)).toEqual(["ratchet", "reports_change", "reconciliation_pending", "sweep_not_automatic"]);
    expect(none[0].message).toContain("If you move the wrong entry, delete it and enter the gift on the correct register.");
    expect(none[0].message).not.toContain("no longer be deleted");
    const unsent = cross({ receipt: "unsent" });
    expect(codes(unsent)).toContain("unsent_receipt_removed");
    expect(codes(unsent)).not.toContain("receipt_sent");
    expect(unsent.find((x) => x.code === "unsent_receipt_removed")!.message).toContain("Nothing was sent to the donor.");
  });

  it("duplicate_candidate is singular for 1 and plural for more, and absent for 0", () => {
    const one = cross({ duplicateCount: 1 }).find((x) => x.code === "duplicate_candidate")!;
    expect(one.message).toContain("1 posted income entry of this amount within 30 days");
    const many = cross({ duplicateCount: 3 }).find((x) => x.code === "duplicate_candidate")!;
    expect(many.message).toContain("3 posted income entries of this amount within 30 days");
    expect(many.message).toContain("A deposit bundled with other money cannot be detected here.");
    expect(codes(cross({ duplicateCount: 0 }))).not.toContain("duplicate_candidate");
  });

  it("sent_statement uses the Foundation label; dest_sent_statement only when the destination has one", () => {
    const w = cross({}, { sent: "2026-09" });
    expect(w.find((x) => x.code === "sent_statement")!.message).toBe(
      "The Foundation statement for September 2026 was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically.",
    );
    expect(codes(w)).not.toContain("dest_sent_statement");
    const both = cross({ destSentStatementMonth: "2026-09" }, { sent: "2026-09" });
    expect(both.find((x) => x.code === "dest_sent_statement")!.message).toContain("The Club statement for September 2026");
  });

  it("reports_change names the fiscal year; aged_public_fund appears only when aged", () => {
    expect(cross().find((x) => x.code === "reports_change")!.message).toContain("FY2026");
    expect(codes(cross({}, { aged: true }))).toContain("aged_public_fund");
    expect(codes(cross({}, { aged: false }))).not.toContain("aged_public_fund");
  });

  it("reconciled and prior_fiscal_year never appear cross-entity, and no copy says the bank balance is unchanged", () => {
    const w = buildMoveWarnings({
      anyDestinationAllowed: true,
      tierReasons: ["reconciled", "prior_fiscal_year"],
      sentStatementMonth: "2026-09",
      aged: true,
      bankAccountName: "Foundation Checking",
      crossEntity: { ...X, destSentStatementMonth: "2026-09", duplicateCount: 2 },
    });
    expect(codes(w)).not.toContain("reconciled");
    expect(codes(w)).not.toContain("prior_fiscal_year");
    for (const x of w) expect(x.message.toLowerCase()).not.toContain("unchanged");
  });
});

describe("sentStatementWarning label and buildSweepMemo (C13)", () => {
  it("the default label is unchanged (Administrative)", () => {
    expect(sentStatementWarning("2026-09")).toBe(sentStatementWarning("2026-09", "Administrative"));
    expect(sentStatementWarning("2026-09")).toContain("The Administrative statement for September 2026");
  });

  it("a v1 source says Administrative, a v2 source says the Foundation", () => {
    const createdAt = new Date("2026-09-30T16:00:00Z");
    expect(buildSweepMemo({ party: "Example Donor", move: { createdAt, sourceLabel: "Administrative" } })).toBe(
      "Sweep of Example Donor gift moved from Administrative on 2026-09-30",
    );
    expect(buildSweepMemo({ party: "Example Donor", move: { createdAt, sourceLabel: "the Foundation" } })).toBe(
      "Sweep of Example Donor gift moved from the Foundation on 2026-09-30",
    );
  });

  it("no audit row says no 'moved' and no date; a missing party reads 'a gift'", () => {
    expect(buildSweepMemo({ party: "Example Donor", move: null })).toBe("Sweep of Example Donor gift");
    expect(buildSweepMemo({ party: "   ", move: null })).toBe("Sweep of a gift");
    expect(buildSweepMemo({ party: null, move: null })).not.toContain("moved");
  });

  it("the date is the audit row's America/New_York date, not UTC (01:30Z on Oct 2 is still Oct 1 in New York)", () => {
    const memo = buildSweepMemo({
      party: "Example Donor",
      move: { createdAt: new Date("2026-10-02T01:30:00Z"), sourceLabel: "the Foundation" },
    });
    expect(memo).toContain("on 2026-10-01");
    expect(memo).not.toContain("2026-10-02");
  });
});
