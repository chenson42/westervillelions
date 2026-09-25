/**
 * Unit tests for src/lib/dues-reminders-queries.ts — getReminderCandidates()'s
 * "Last reminded" badge (via the private getLastRemindedMap()).
 *
 * B-73 follow-up (docs/work-log/2026-09-25-bulk-send-success-columns.md):
 * getLastRemindedMap()'s raw SQL had no `success` filter at all, so a member
 * whose only dues_reminders row was a failed/blocked send (success: false)
 * still lit up the "Last reminded" badge as if they'd been reminded. The fix
 * adds `AND success = true` to the WHERE clause (not a post-hoc filter after
 * DISTINCT ON), so DISTINCT ON selects the most recent row among only the
 * successful ones per member.
 *
 * These tests don't hit a real Postgres, but the mocked db.execute() below
 * doesn't just hand back a canned array either — it inspects the ACTUAL sql``
 * text the module under test sends (via drizzle-orm's own PgDialect, the same
 * technique board-positions.test.ts uses for a `where` condition) and, only
 * if that text contains `success = true`, filters a raw fixture of
 * dues_reminders-shaped rows before emulating `DISTINCT ON (member_id) ...
 * ORDER BY member_id, sent_at DESC`. This is what makes the first two tests
 * below genuinely fail against the pre-fix query (which has no such clause)
 * rather than just asserting on hand-picked mock output — reverting the
 * `AND success = true` clause makes the mock behave exactly like the old,
 * unfiltered query.
 *
 * Hermetic: mocks @/lib/db (the connection module, same convention as
 * board-positions.test.ts / minutes-queries.test.ts) so `pnpm test` passes
 * without DATABASE_URL/DB_URL set. Also mocks @/lib/dues-queries entirely so
 * listMemberDuesStatus() never touches db.execute — this isolates the single
 * remaining db.execute call to getLastRemindedMap()'s own query.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

type RawReminderRow = {
  member_id: string;
  sent_at: string;
  cohort: string;
  success: boolean;
};

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    // A raw, unfiltered fixture of dues_reminders rows, as if read straight
    // from the table — i.e. BOTH successful and failed/blocked attempts.
    fixtureRows: [] as RawReminderRow[],
    lastQueryText: "",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn((query: unknown) => {
      const dialect = new PgDialect();
      const { sql: text } = dialect.sqlToQuery(query as never);
      const lower = text.toLowerCase();
      mockDbState.lastQueryText = lower;

      // Emulate the WHERE clause: only apply the success filter if the
      // module under test actually sent one. This is the load-bearing bit —
      // it makes these tests fail against the pre-fix query, which has no
      // `success = true` in it, rather than only against a hand-picked mock.
      const filtersOnSuccess = /success\s*=\s*true/.test(lower);
      const candidateRows = filtersOnSuccess
        ? mockDbState.fixtureRows.filter((r) => r.success)
        : mockDbState.fixtureRows;

      // Emulate `DISTINCT ON (member_id) ... ORDER BY member_id, sent_at DESC`.
      const byMember = new Map<string, RawReminderRow>();
      for (const r of candidateRows) {
        const existing = byMember.get(r.member_id);
        if (!existing || r.sent_at > existing.sent_at) {
          byMember.set(r.member_id, r);
        }
      }
      return Promise.resolve(
        Array.from(byMember.values()).map((r) => ({
          member_id: r.member_id,
          sent_at: r.sent_at,
          cohort: r.cohort,
        })),
      );
    }),
  },
}));

const STATUSES = [
  {
    memberId: "m-unpaid",
    memberNumber: 1,
    firstName: "Pat",
    lastName: "Lopez",
    email: "pat@westervillelions.org",
    isActive: true,
    duesCategory: "individual",
    totalPaidCents: 0,
    expectedAmountCents: 5000,
    status: "unpaid" as const,
  },
];

vi.mock("@/lib/dues-queries", () => ({
  listMemberDuesStatus: vi.fn(() => Promise.resolve(STATUSES)),
}));

import { getReminderCandidates } from "./dues-reminders-queries";

beforeEach(() => {
  mockDbState.fixtureRows = [];
  mockDbState.lastQueryText = "";
  vi.clearAllMocks();
});

describe("getReminderCandidates — Last Reminded badge (B-73 follow-up)", () => {
  it("shows a member as NOT reminded when their only row is a failed send (success: false)", async () => {
    mockDbState.fixtureRows = [
      { member_id: "m-unpaid", sent_at: "2026-09-23T10:00:00.000Z", cohort: "unpaid", success: false },
    ];

    const { unpaid } = await getReminderCandidates(2026);

    const candidate = unpaid.find((c) => c.memberId === "m-unpaid");
    expect(candidate).toBeDefined();
    expect(candidate!.lastReminded).toBeNull();
  });

  it("shows the EARLIER successful date, not a later failed attempt (DISTINCT ON ordering trap)", async () => {
    mockDbState.fixtureRows = [
      { member_id: "m-unpaid", sent_at: "2026-09-21T10:00:00.000Z", cohort: "unpaid", success: true },
      { member_id: "m-unpaid", sent_at: "2026-09-23T10:00:00.000Z", cohort: "unpaid", success: false },
    ];

    const { unpaid } = await getReminderCandidates(2026);

    const candidate = unpaid.find((c) => c.memberId === "m-unpaid");
    expect(candidate!.lastReminded).toEqual({
      sentAt: "2026-09-21T10:00:00.000Z",
      cohort: "unpaid",
    });
  });

  it("shows a successful reminder normally — no regression", async () => {
    mockDbState.fixtureRows = [
      { member_id: "m-unpaid", sent_at: "2026-09-22T10:00:00.000Z", cohort: "unpaid", success: true },
    ];

    const { unpaid } = await getReminderCandidates(2026);

    const candidate = unpaid.find((c) => c.memberId === "m-unpaid");
    expect(candidate!.lastReminded).toEqual({
      sentAt: "2026-09-22T10:00:00.000Z",
      cohort: "unpaid",
    });
  });

  it("the query text sent to the database filters on success = true", async () => {
    await getReminderCandidates(2026);

    expect(mockDbState.lastQueryText).toMatch(/success\s*=\s*true/);
    expect(mockDbState.lastQueryText).toMatch(/fiscal_year/);
  });
});
