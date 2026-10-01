/** T8-T10: reason normalizer, move-body parser, audit payload shapes. */
import { describe, it, expect } from "vitest";
import {
  TRANSACTION_DELETED_AUDIT_ACTION,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  buildMoveWarnings,
  formatStatementMonth,
  isRawAudit,
  normalizeCorrectionReason,
  parseAuditAfter,
  parseAuditBefore,
  parseAuditDetails,
  parseDeleteBody,
  parseMoveBody,
  serializeAuditPayload,
  type FundMoveAuditPayload,
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
  it("accepts exactly the four keys", () => {
    expect(parseMoveBody(GOOD)).toEqual({ ok: true, value: GOOD });
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
