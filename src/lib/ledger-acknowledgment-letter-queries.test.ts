/**
 * Unit tests for src/lib/ledger-acknowledgment-letter-queries.ts —
 * Acknowledgment / Thank-You Letter Generation DB layer (DECISION-072/073,
 * 2026-08-08). Covers Phase 3's named tests 10-18.
 *
 * Hermetic: mocks @/lib/db (FIFO select queue + captured insert/update
 * calls, mirroring the established pattern in
 * src/lib/ledger-category-queries.test.ts) — importing the real @/lib/db
 * throws at import time without DATABASE_URL/DB_URL set. Schema symbols
 * (@/lib/db/schema) are imported for real — that module has no DB
 * connection side effect at import time.
 *
 * generateAcknowledgmentLetters() always issues exactly TWO db.select()
 * calls in sequence — listGeneratableAcknowledgments({ ackIds }) first,
 * then getLetterTemplate() — regardless of whether any row ends up
 * generating. Every test therefore pushes two entries onto selectQueue, in
 * that order.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    wheres: [] as unknown[],
    updateCalls: [] as { table: unknown; values: Record<string, unknown> }[],
    updateReturningQueue: [] as unknown[][],
    insertCalls: [] as { table: unknown; values: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => {
  function selectChain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => obj,
      limit: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.selectQueue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }

  function makeClient() {
    return {
      select: () => selectChain(),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          mockDbState.insertCalls.push({ table, values });
          return Promise.resolve(undefined);
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            mockDbState.updateCalls.push({ table, values });
            const p = Promise.resolve(undefined) as Promise<unknown> & {
              returning: () => Promise<unknown[]>;
            };
            p.returning = () => Promise.resolve(mockDbState.updateReturningQueue.shift() ?? []);
            return p;
          },
        }),
      }),
    };
  }

  return {
    db: {
      ...makeClient(),
      transaction: async (cb: (tx: unknown) => unknown) => cb(makeClient()),
    },
  };
});

import {
  listGeneratableAcknowledgments,
  getLetterTemplate,
  updateLetterTemplate,
  generateAcknowledgmentLetters,
  type LetterTemplatePatch,
} from "./ledger-acknowledgment-letter-queries";
import { composeAcknowledgmentLetter } from "./ledger-acknowledgment-letter";

function resetMockDb() {
  mockDbState.selectQueue = [];
  mockDbState.wheres = [];
  mockDbState.updateCalls = [];
  mockDbState.updateReturningQueue = [];
  mockDbState.insertCalls = [];
}

beforeEach(() => {
  resetMockDb();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ackRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ack-1",
    donationTxnId: "txn-1",
    donorId: "donor-1",
    amountCents: 50000,
    txnDate: "2026-03-03",
    type: "written_ack_250",
    quidProQuoValueCents: null,
    quidProQuoDescription: null,
    sentAt: null,
    letterStorageKey: null,
    letterText: null,
    recordedByUserId: "user-1",
    createdAt: new Date("2026-03-03"),
    updatedAt: new Date("2026-03-03"),
    ...overrides,
  };
}

function entityRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "entity-foundation",
    slug: "foundation",
    name: "Westerville Lions Club Foundation",
    shortName: "Foundation",
    taxClassification: "501c3",
    charityStatus: "public_charity",
    ein: "32-0467239",
    ohioEntityNumber: null,
    fiscalYearEnd: "06-30",
    donationsDeductible: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function donorRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "donor-1",
    name: "Jane Donor",
    emails: [],
    address: "123 Main St, Westerville, OH 43081",
    memberId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function joinedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ack: ackRow(),
    donor: donorRow(),
    entity: entityRow(),
    categoryAckNotRequired: false,
    ...overrides,
  };
}

function templateRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "template-1",
    greeting: "Dear {{donorName}},",
    bodyText: "Thank you for your gift.",
    closing: "With gratitude,",
    signatureName: "Jane Treasurer",
    signatureTitle: "Treasurer, Westerville Lions Club Foundation",
    updatedByUserId: null,
    updatedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateAcknowledgmentLetters — Guards (Tests 10-13)
// ---------------------------------------------------------------------------

describe("generateAcknowledgmentLetters — guards", () => {
  it("Test 10: skips a row with no donor linked, reason 'no donor linked'", async () => {
    mockDbState.selectQueue.push([joinedRow({ ack: ackRow({ donorId: null }), donor: null })]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([{ ackId: "ack-1", status: "skipped", reason: "no donor linked" }]);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("Test 11: skips a donor-linked row with no address, reason 'donor missing address'", async () => {
    mockDbState.selectQueue.push([joinedRow({ donor: donorRow({ address: null }) })]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "donor missing address" },
    ]);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("Test 11b: an address that is only whitespace is also treated as missing", async () => {
    mockDbState.selectQueue.push([joinedRow({ donor: donorRow({ address: "   " }) })]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "donor missing address" },
    ]);
  });

  it("Test 12: skips a row whose category is ackNotRequired via a fresh JOIN re-check, reason 'category excluded from acknowledgments'", async () => {
    // The flag is read live off the join for THIS call — this fixture
    // models the case where ackNotRequired was toggled true on the
    // category AFTER the ack row already existed. Nothing about this call
    // inherits an "excluded" state from when the ack was created; it's
    // re-derived fresh, every time.
    mockDbState.selectQueue.push([joinedRow({ categoryAckNotRequired: true })]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "category excluded from acknowledgments" },
    ]);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("Test 13: skips an already-sent row, reason 'already sent', and never attempts to write it", async () => {
    mockDbState.selectQueue.push([
      joinedRow({
        ack: ackRow({ sentAt: new Date("2026-01-01"), letterText: "ORIGINAL LETTER TEXT" }),
      }),
    ]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([{ ackId: "ack-1", status: "skipped", reason: "already sent" }]);
    // letter_text is unchanged by the call — proven by asserting no update
    // was ever attempted for this row, not by re-reading a stored value
    // (hermetic mock has no persistent store to re-read).
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("an id that doesn't resolve to any hydrated row is skipped, reason 'not found'", async () => {
    mockDbState.selectQueue.push([]); // no rows hydrated at all
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-missing"]);

    expect(results).toEqual([{ ackId: "ack-missing", status: "skipped", reason: "not found" }]);
  });

  it("an unrecognized ack.type is skipped, reason 'unrecognized acknowledgment type'", async () => {
    mockDbState.selectQueue.push([joinedRow({ ack: ackRow({ type: "some_corrupted_value" }) })]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "unrecognized acknowledgment type" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// generateAcknowledgmentLetters — successful write (Test 14)
// ---------------------------------------------------------------------------

describe("generateAcknowledgmentLetters — successful generation", () => {
  it("Test 14: generates and writes letter_text for a valid unsent row; written value matches composeAcknowledgmentLetter()'s own output for the same inputs", async () => {
    const row = joinedRow();
    mockDbState.selectQueue.push([row]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ackId: "ack-1", status: "generated" });
    const generated = results[0] as { ackId: string; status: "generated"; letterText: string };

    const expected = composeAcknowledgmentLetter({
      entity: {
        name: row.entity.name,
        ein: row.entity.ein,
        taxClassification: row.entity.taxClassification,
      },
      donor: { name: row.donor.name, address: row.donor.address as string },
      ack: {
        type: row.ack.type as "written_ack_250",
        amountCents: row.ack.amountCents,
        txnDate: row.ack.txnDate,
        quidProQuoValueCents: row.ack.quidProQuoValueCents,
        quidProQuoDescription: row.ack.quidProQuoDescription,
      },
      template: {
        greeting: "Dear {{donorName}},",
        bodyText: "Thank you for your gift.",
        closing: "With gratitude,",
        signatureName: "Jane Treasurer",
        signatureTitle: "Treasurer, Westerville Lions Club Foundation",
      },
    });

    expect(generated.letterText).toBe(expected);
    expect(mockDbState.updateCalls).toHaveLength(1);
    expect(mockDbState.updateCalls[0].values.letterText).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// generateAcknowledgmentLetters — batch skip-before-transact (Test 15)
// ---------------------------------------------------------------------------

describe("generateAcknowledgmentLetters — batch semantics", () => {
  it("Test 15: a batch of 3 ackIds where 1 fails a pre-validation guard still writes the other 2 inside the transaction", async () => {
    const row1 = joinedRow({ ack: ackRow({ id: "ack-1", donationTxnId: "txn-1" }) });
    const row2 = joinedRow({
      ack: ackRow({ id: "ack-2", donationTxnId: "txn-2" }),
      donor: donorRow({ id: "donor-2", name: "John Donor" }),
    });
    // "ack-3" is deliberately absent from the hydrated result set -> "not found".
    mockDbState.selectQueue.push([row1, row2]);
    mockDbState.selectQueue.push([templateRow()]);

    const results = await generateAcknowledgmentLetters(["ack-1", "ack-2", "ack-3"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "generated", letterText: expect.any(String) },
      { ackId: "ack-2", status: "generated", letterText: expect.any(String) },
      { ackId: "ack-3", status: "skipped", reason: "not found" },
    ]);
    // Both passing rows were written — the failing row never entered the
    // transaction and did not block the other two (skip-before-transact,
    // not one-bad-row-aborts-all).
    expect(mockDbState.updateCalls).toHaveLength(2);
    expect(mockDbState.updateCalls.map((c) => c.table)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateLetterTemplate — allowlist + audit trail (Tests 16-17)
// ---------------------------------------------------------------------------

describe("updateLetterTemplate", () => {
  it("Test 16: ignores any key outside the five-field allowlist even if present in the input object", async () => {
    const existing = templateRow();
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, greeting: "New greeting" }]);

    // Constructed as an untyped object to exercise the RUNTIME boundary,
    // not just the LetterTemplatePatch type — a caller reaching this
    // function via a differently-typed or `as any`-cast path must still be
    // structurally unable to write an unlisted column.
    const maliciousPatch = {
      greeting: "New greeting",
      maliciousField: "should never be written",
    } as LetterTemplatePatch & { maliciousField: string };

    await updateLetterTemplate(maliciousPatch, "user-1");

    expect(mockDbState.updateCalls).toHaveLength(1);
    expect(mockDbState.updateCalls[0].values).not.toHaveProperty("maliciousField");
    expect(mockDbState.updateCalls[0].values.greeting).toBe("New greeting");
  });

  it("Test 17: writes a ledger_audit_log row with before/after containing only the fields that actually changed", async () => {
    const existing = templateRow({ greeting: "Old greeting", closing: "Old closing" });
    mockDbState.selectQueue.push([existing]);
    mockDbState.updateReturningQueue.push([{ ...existing, greeting: "New greeting" }]);

    // closing is included in the patch but with its EXISTING value — must
    // not appear in the diff.
    await updateLetterTemplate({ greeting: "New greeting", closing: "Old closing" }, "user-1");

    expect(mockDbState.insertCalls).toHaveLength(1);
    const audit = mockDbState.insertCalls[0];
    expect(audit.values.action).toBe("ack_letter_template_updated");
    expect(audit.values.actorUserId).toBe("user-1");
    expect(audit.values.targetCategoryId).toBeNull();
    expect(JSON.parse(audit.values.before as string)).toEqual({ greeting: "Old greeting" });
    expect(JSON.parse(audit.values.after as string)).toEqual({ greeting: "New greeting" });
  });

  it("a no-op patch (values equal to existing) writes nothing and skips the audit row", async () => {
    const existing = templateRow({ greeting: "Same greeting" });
    mockDbState.selectQueue.push([existing]);

    const result = await updateLetterTemplate({ greeting: "Same greeting" }, "user-1");

    expect(result).toEqual(existing);
    expect(mockDbState.updateCalls).toHaveLength(0);
    expect(mockDbState.insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getLetterTemplate — seeded row vs. fallback (Test 18)
// ---------------------------------------------------------------------------

describe("getLetterTemplate", () => {
  it("Test 18a: returns the seeded singleton row when present", async () => {
    const row = templateRow({ greeting: "Custom greeting" });
    mockDbState.selectQueue.push([row]);

    const result = await getLetterTemplate();

    expect(result).toEqual(row);
  });

  it("Test 18b: returns a sane in-code fallback (mirroring getSettings()) when the table is empty", async () => {
    mockDbState.selectQueue.push([]);

    const result = await getLetterTemplate();

    expect(result.greeting).toBe("Dear {{donorName}},");
    expect(result.closing).toBe("With gratitude,");
    expect(result.signatureName).toBe("");
    expect(result.signatureTitle).toBe("Treasurer, Westerville Lions Club Foundation");
  });
});

// ---------------------------------------------------------------------------
// listGeneratableAcknowledgments — listing-mode ackNotRequired exclusion
// ---------------------------------------------------------------------------

describe("listGeneratableAcknowledgments", () => {
  it("unscoped (listing) mode excludes rows whose category is ackNotRequired", async () => {
    mockDbState.selectQueue.push([
      joinedRow({ ack: ackRow({ id: "ack-1" }), categoryAckNotRequired: false }),
      joinedRow({ ack: ackRow({ id: "ack-2" }), categoryAckNotRequired: true }),
    ]);

    const rows = await listGeneratableAcknowledgments();

    expect(rows.map((r) => r.ackId)).toEqual(["ack-1"]);
  });

  it("scoped (ackIds) mode returns ALL requested rows, including ackNotRequired/sent ones, unfiltered", async () => {
    mockDbState.selectQueue.push([
      joinedRow({ ack: ackRow({ id: "ack-1" }), categoryAckNotRequired: true }),
      joinedRow({
        ack: ackRow({ id: "ack-2", sentAt: new Date("2026-01-01") }),
        categoryAckNotRequired: false,
      }),
    ]);

    const rows = await listGeneratableAcknowledgments({ ackIds: ["ack-1", "ack-2"] });

    expect(rows.map((r) => r.ackId).sort()).toEqual(["ack-1", "ack-2"]);
  });
});
