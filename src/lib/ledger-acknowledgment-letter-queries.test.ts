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

vi.mock("@/lib/email", () => ({ sendBulkMemberEmail: vi.fn() }));
vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn() }));

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
  emailAcknowledgmentLetters,
  type LetterTemplatePatch,
} from "./ledger-acknowledgment-letter-queries";
import { composeAcknowledgmentLetter } from "./ledger-acknowledgment-letter";
import { sendBulkMemberEmail } from "@/lib/email";
import { resolveTreasurer } from "@/lib/board-positions";

function resetMockDb() {
  mockDbState.selectQueue = [];
  mockDbState.wheres = [];
  mockDbState.updateCalls = [];
  mockDbState.updateReturningQueue = [];
  mockDbState.insertCalls = [];
}

const DEFAULT_TREASURER = {
  ok: true as const,
  memberId: "member-treasurer",
  firstName: "Terry",
  lastName: "Treasurer",
  email: "treasurer@westervillelions.org",
};

beforeEach(() => {
  resetMockDb();
  vi.mocked(sendBulkMemberEmail).mockReset();
  vi.mocked(resolveTreasurer).mockReset();
  vi.mocked(resolveTreasurer).mockResolvedValue(DEFAULT_TREASURER);
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

// ---------------------------------------------------------------------------
// emailAcknowledgmentLetters — Emailing the Donor Acknowledgment Letter
// (2026-08-12, DECISION-087/088). Phase 3 design doc, Unit Tests 4-13.
// ---------------------------------------------------------------------------

describe("emailAcknowledgmentLetters — guards (Tests 4-8)", () => {
  it("Test 4: skips an id not present in the hydrated rows, reason 'not found', and never attempts a claim UPDATE for it", async () => {
    mockDbState.selectQueue.push([]); // nothing hydrated

    const results = await emailAcknowledgmentLetters(["ack-missing"]);

    expect(results).toEqual([{ ackId: "ack-missing", status: "skipped", reason: "not found" }]);
    expect(mockDbState.updateCalls).toHaveLength(0);
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("Test 5: skips an ack whose sentAt is already non-null (pre-check), reason 'already sent', without attempting the claim UPDATE at all", async () => {
    mockDbState.selectQueue.push([
      joinedRow({
        ack: ackRow({ sentAt: new Date("2026-01-01"), letterText: "Composed letter." }),
        donor: donorRow({ emails: ["jane@example.com"] }),
      }),
    ]);

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([{ ackId: "ack-1", status: "skipped", reason: "already sent" }]);
    // The pre-check short-circuits BEFORE the write, not merely produces the
    // same outcome as if it hadn't — no claim UPDATE was even attempted.
    expect(mockDbState.updateCalls).toHaveLength(0);
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
  });

  it("Test 6: skips an ack with letterText === null, reason 'letter not yet generated'", async () => {
    mockDbState.selectQueue.push([
      joinedRow({
        ack: ackRow({ letterText: null }),
        donor: donorRow({ emails: ["jane@example.com"] }),
      }),
    ]);

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "letter not yet generated" },
    ]);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("Test 7: skips an ack with donor === null, reason 'no donor linked'", async () => {
    mockDbState.selectQueue.push([
      joinedRow({ ack: ackRow({ letterText: "Composed letter." }), donor: null }),
    ]);

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([{ ackId: "ack-1", status: "skipped", reason: "no donor linked" }]);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("Test 8: skips an ack whose donor has emails: [], reason 'donor has no email on file'", async () => {
    mockDbState.selectQueue.push([
      joinedRow({
        ack: ackRow({ letterText: "Composed letter." }),
        donor: donorRow({ emails: [] }),
      }),
    ]);

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "donor has no email on file" },
    ]);
    expect(mockDbState.updateCalls).toHaveLength(0);
  });
});

describe("emailAcknowledgmentLetters — the atomic claim (Test 9, load-bearing)", () => {
  it("Test 9: a second send for the same not-yet-sent ack is skipped 'already sent' by the atomic claim, never double-sent, even when its pre-check read is stale", async () => {
    const row = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Composed letter text." }),
      donor: donorRow({ id: "donor-1", emails: ["donor@example.com"] }),
    });

    // Call 1: pre-check sees sentAt IS NULL, the claim UPDATE succeeds
    // (returns the row), the send succeeds.
    mockDbState.selectQueue.push([row]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [{ to: "donor@example.com", success: true, emailQueueId: "q-1" }],
    });

    const firstResults = await emailAcknowledgmentLetters(["ack-1"]);

    // Call 2: pre-check STILL sees sentAt IS NULL — a stale read that
    // started before call 1's claim committed, exactly the race this guard
    // exists for — but its claim UPDATE returns ZERO rows, because call 1
    // already claimed the row. This is what must produce the skip, not the
    // (stale) pre-check.
    mockDbState.selectQueue.push([row]);
    mockDbState.updateReturningQueue.push([]);

    const secondResults = await emailAcknowledgmentLetters(["ack-1"]);

    expect(firstResults).toEqual([
      {
        ackId: "ack-1",
        status: "emailed",
        addresses: [{ to: "donor@example.com", success: true }],
      },
    ]);
    expect(secondResults).toEqual([
      { ackId: "ack-1", status: "skipped", reason: "already sent" },
    ]);
    // The second call's claim lost the race BEFORE any send was attempted
    // for it — sendBulkMemberEmail was invoked exactly once across both
    // calls, never twice for the same ack.
    expect(sendBulkMemberEmail).toHaveBeenCalledTimes(1);
  });
});

describe("emailAcknowledgmentLetters — revert on total failure (Test 10)", () => {
  it("Test 10: every address failing reverts sentAt/sentVia to NULL, reports 'failed', and a later call is retried as a fresh candidate (not skipped 'already sent')", async () => {
    const row = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Composed letter text." }),
      donor: donorRow({ id: "donor-1", emails: ["donor@example.com"] }),
    });

    mockDbState.selectQueue.push([row]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]); // claim succeeds
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [
        { to: "donor@example.com", success: false, error: "Resend rejected", emailQueueId: "q-1" },
      ],
    });

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      {
        ackId: "ack-1",
        status: "failed",
        reason: "delivery failed for all addresses — not marked sent, safe to retry",
      },
    ]);

    // Two update calls: the claim, then the compensating revert — the
    // revert is proven by asserting the ACTUAL write the code issued, not
    // by re-reading a persisted value (the hermetic mock has no store to
    // re-read).
    expect(mockDbState.updateCalls).toHaveLength(2);
    expect(mockDbState.updateCalls[0].values).toMatchObject({
      sentAt: expect.any(Date),
      sentVia: "email",
    });
    expect(mockDbState.updateCalls[1].values).toMatchObject({ sentAt: null, sentVia: null });

    // A later call for the same ackId is NOT skipped "already sent" — the
    // revert means it's a fresh candidate again.
    mockDbState.selectQueue.push([row]); // sentAt still null (as reverted)
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [{ to: "donor@example.com", success: true, emailQueueId: "q-2" }],
    });

    const retryResults = await emailAcknowledgmentLetters(["ack-1"]);

    expect(retryResults[0].status).toBe("emailed");
  });
});

describe("emailAcknowledgmentLetters — partial multi-address success (Test 11)", () => {
  it("Test 11: one of two addresses succeeding keeps the claim, reports 'emailed' with per-address detail, both success and failure shown", async () => {
    const row = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Composed letter text." }),
      donor: donorRow({ id: "donor-1", emails: ["a@example.com", "b@example.com"] }),
    });

    mockDbState.selectQueue.push([row]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [
        { to: "a@example.com", success: true, emailQueueId: "q-1" },
        { to: "b@example.com", success: false, error: "bounced", emailQueueId: "q-2" },
      ],
    });

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results).toEqual([
      {
        ackId: "ack-1",
        status: "emailed",
        addresses: [
          { to: "a@example.com", success: true },
          { to: "b@example.com", success: false, error: "bounced" },
        ],
      },
    ]);
    // Claim kept — exactly ONE update call (the claim), no revert.
    expect(mockDbState.updateCalls).toHaveLength(1);
  });
});

describe("emailAcknowledgmentLetters — shared address across two donors (Test 12)", () => {
  it("Test 12: results are zipped by array index, never by address string, so two donors sharing one inbox each get their own outcome", async () => {
    const row1 = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Letter for donor A." }),
      donor: donorRow({ id: "donor-a", name: "Donor A", emails: ["shared@example.com"] }),
    });
    const row2 = joinedRow({
      ack: ackRow({ id: "ack-2", letterText: "Letter for donor B." }),
      donor: donorRow({ id: "donor-b", name: "Donor B", emails: ["shared@example.com"] }),
    });

    mockDbState.selectQueue.push([row1, row2]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]); // ack-1's claim
    mockDbState.updateReturningQueue.push([{ id: "ack-2" }]); // ack-2's claim
    // The mock's behavior is keyed by CALL POSITION, not by the address
    // string — both entries use the identical "to" value. If the
    // implementation regrouped results by looking up the "to" address
    // instead of the parallel meta[]/sendResults[] index, both acks would
    // incorrectly collapse onto the same outcome.
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [
        { to: "shared@example.com", success: false, error: "mailbox full", emailQueueId: "q-1" },
        { to: "shared@example.com", success: true, emailQueueId: "q-2" },
      ],
    });

    const results = await emailAcknowledgmentLetters(["ack-1", "ack-2"]);

    expect(results).toEqual([
      {
        ackId: "ack-1",
        status: "failed",
        reason: "delivery failed for all addresses — not marked sent, safe to retry",
      },
      {
        ackId: "ack-2",
        status: "emailed",
        addresses: [{ to: "shared@example.com", success: true }],
      },
    ]);
  });
});

describe("emailAcknowledgmentLetters — one sendBulkMemberEmail() call per batch (Test 13)", () => {
  it("Test 13: calls sendBulkMemberEmail exactly once per invocation for a multi-ack batch, not once per ack", async () => {
    const row1 = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Letter 1" }),
      donor: donorRow({ id: "donor-1", emails: ["a@example.com"] }),
    });
    const row2 = joinedRow({
      ack: ackRow({ id: "ack-2", letterText: "Letter 2" }),
      donor: donorRow({ id: "donor-2", emails: ["b@example.com"] }),
    });
    const row3 = joinedRow({
      ack: ackRow({ id: "ack-3", letterText: "Letter 3" }),
      donor: donorRow({ id: "donor-3", emails: ["c@example.com"] }),
    });

    mockDbState.selectQueue.push([row1, row2, row3]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]);
    mockDbState.updateReturningQueue.push([{ id: "ack-2" }]);
    mockDbState.updateReturningQueue.push([{ id: "ack-3" }]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [
        { to: "a@example.com", success: true, emailQueueId: "q-1" },
        { to: "b@example.com", success: true, emailQueueId: "q-2" },
        { to: "c@example.com", success: true, emailQueueId: "q-3" },
      ],
    });

    await emailAcknowledgmentLetters(["ack-1", "ack-2", "ack-3"]);

    expect(sendBulkMemberEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendBulkMemberEmail).mock.calls[0][0];
    expect(call.recipients).toHaveLength(3);
  });
});

describe("emailAcknowledgmentLetters — envelope (from/subject/replyTo/bcc) and tolerant resolveTreasurer()", () => {
  it("uses the fixed From/subject and puts the resolved Treasurer on Reply-To and BCC only — never as body prose", async () => {
    const row = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Composed letter text." }),
      donor: donorRow({ id: "donor-1", emails: ["donor@example.com"] }),
    });

    mockDbState.selectQueue.push([row]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [{ to: "donor@example.com", success: true, emailQueueId: "q-1" }],
    });

    await emailAcknowledgmentLetters(["ack-1"]);

    const call = vi.mocked(sendBulkMemberEmail).mock.calls[0][0];
    expect(call.from).toBe("treasurer@westervillelions.org");
    expect(call.subject).toBe(
      "Your Official Gift Acknowledgment — Thank You for Your Generosity",
    );
    expect(call.replyTo).toBe(DEFAULT_TREASURER.email);
    expect(call.bcc).toBe(DEFAULT_TREASURER.email);
    // The composed HTML body is the letter itself plus the lead-in — the
    // Treasurer's name never appears as a second signature inside it.
    expect(call.recipients[0].html).not.toContain(DEFAULT_TREASURER.firstName);
  });

  it("a resolveTreasurer() failure is tolerant — logs and sends without replyTo/bcc rather than blocking the donor's receipt", async () => {
    vi.mocked(resolveTreasurer).mockResolvedValueOnce({ ok: false, reason: "none" });
    const row = joinedRow({
      ack: ackRow({ id: "ack-1", letterText: "Composed letter text." }),
      donor: donorRow({ id: "donor-1", emails: ["donor@example.com"] }),
    });

    mockDbState.selectQueue.push([row]);
    mockDbState.updateReturningQueue.push([{ id: "ack-1" }]);
    vi.mocked(sendBulkMemberEmail).mockResolvedValueOnce({
      results: [{ to: "donor@example.com", success: true, emailQueueId: "q-1" }],
    });

    const results = await emailAcknowledgmentLetters(["ack-1"]);

    expect(results[0].status).toBe("emailed");
    const call = vi.mocked(sendBulkMemberEmail).mock.calls[0][0];
    expect(call.replyTo).toBeUndefined();
    expect(call.bcc).toBeUndefined();
  });
});
