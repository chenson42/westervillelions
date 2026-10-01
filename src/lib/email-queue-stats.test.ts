/**
 * Unit tests for getFailedEmailCount() and resetStaleRetryingEmails(),
 * which back the admin nav's failed-email-count badge (Phase 6 follow-up #1,
 * docs/work-log/2026-09-25-email-silent-success.md) and the fix for the
 * `retrying`-row stranding gap qa flagged in that same work-log's Phase 5
 * re-verification (B-66, docs/work-log/2026-09-25-retry-stranding.md).
 *
 * Hermetic: mocks @/lib/db — importing the real module throws at import time
 * without DATABASE_URL (same rationale as src/lib/ledger-queries.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Pulls the bare bound parameter values out of a real drizzle-orm SQL
 * fragment, in composition order. This file uses the REAL `emailQueue`
 * schema (unlike src/app/api/admin/email-queue/retry/route.test.ts, which
 * mocks `@/lib/db/schema` to `{}`) — a real column encoder wraps each bound
 * value in a `Param { value, encoder }` node rather than leaving a bare
 * string/Date in `queryChunks`, and a real `timestamptz` column's value
 * arrives pre-serialized to an ISO string, not a `Date` instance. Both
 * shapes are handled here.
 */
function extractSqlParams(node: unknown, acc: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const el of node) {
      if (typeof el === "string" || el instanceof Date) acc.push(el);
      else extractSqlParams(el, acc);
    }
  } else if (node && typeof node === "object") {
    if (Array.isArray((node as { queryChunks?: unknown }).queryChunks)) {
      extractSqlParams((node as { queryChunks: unknown[] }).queryChunks, acc);
    } else if ("encoder" in node && "value" in node) {
      const value = (node as { value: unknown }).value;
      // A real drizzle-orm `Param` node — the bound value the query will
      // actually send. A timestamptz column's Date value is only converted
      // to its driver string at execution time, not at query-build time, so
      // this can still be a real `Date` instance here.
      if (typeof value === "string" || value instanceof Date) acc.push(value);
    }
  }
  return acc;
}

type PurgeRow = {
  id: string;
  status: string;
  sentAt: Date | null;
  createdAt: Date;
};

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    countRows: [{ count: 0 }] as { count: number }[],
    lastWhereArg: null as unknown,
    // Rows available to resetStaleRetryingEmails()'s UPDATE. Only rows whose
    // CURRENT status is "retrying" and whose retryingAt is older than the
    // extracted cutoff are matched — mirrors a real
    // `WHERE status = 'retrying' AND retrying_at < $cutoff` predicate.
    retryingRows: [] as { id: string; status: string; retryingAt: Date | null }[],
    // Rows available to pruneEmailQueue()'s DELETE, the compiled where-clause
    // it was handed, and an optional error for the delete to reject with.
    purgeRows: [] as PurgeRow[],
    lastDeleteCond: null as unknown,
    deleteError: null as Error | null,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: (arg: unknown) => {
          mockDbState.lastWhereArg = arg;
          return Promise.resolve(mockDbState.countRows);
        },
      }),
    })),
    insert: vi.fn(),
    delete: vi.fn(() => ({
      where: (cond: unknown) => ({
        returning: async () => {
          mockDbState.lastDeleteCond = cond;
          if (mockDbState.deleteError) throw mockDbState.deleteError;
          // TEST EVALUATOR, not the system under test: a mocked db cannot
          // evaluate SQL, so this applies the operator semantics of the
          // predicate pinned in the "pins the exact predicate" test —
          //   status <> $1 AND COALESCE(sent_at, created_at) < $2::timestamp
          // — to fixture rows. It is only trusted because that test proves
          // the compiled SQL has exactly this shape.
          const { params } = new PgDialect().sqlToQuery(cond as SQL);
          const [statusParam, cutoffParam] = params as [string, string];
          const cutoff = new Date(cutoffParam);
          const doomed = mockDbState.purgeRows.filter(
            (r) => r.status !== statusParam && (r.sentAt ?? r.createdAt) < cutoff
          );
          mockDbState.purgeRows = mockDbState.purgeRows.filter((r) => !doomed.includes(r));
          return doomed.map((r) => ({ id: r.id }));
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            // extractSqlParams composition order for
            // and(eq(status, "retrying"), lt(retryingAt, cutoff)) is
            // ["retrying", cutoffValue] — cutoffValue may still be a real
            // `Date` instance (a timestamptz column only serializes to its
            // driver string at execution time, not at query-build time).
            const [statusValue, cutoffRaw] = extractSqlParams(cond) as [
              string | undefined,
              string | Date | undefined,
            ];
            const cutoff = cutoffRaw !== undefined ? new Date(cutoffRaw) : undefined;
            const matched = mockDbState.retryingRows.filter(
              (r) =>
                r.status === statusValue &&
                cutoff !== undefined &&
                r.retryingAt !== null &&
                r.retryingAt < cutoff
            );
            for (const row of matched) Object.assign(row, values);
            return matched.map((r) => ({ id: r.id }));
          },
        }),
      }),
    })),
  },
}));

import {
  getFailedEmailCount,
  resetStaleRetryingEmails,
  RETRY_STALE_MINUTES,
  EMAIL_QUEUE_RETENTION_DAYS,
  emailQueueRetentionCutoff,
  pruneEmailQueue,
} from "./email-queue-stats";

describe("getFailedEmailCount", () => {
  beforeEach(() => {
    mockDbState.countRows = [{ count: 0 }];
    mockDbState.lastWhereArg = null;
  });

  it("returns the count from the query result", async () => {
    mockDbState.countRows = [{ count: 5 }];

    expect(await getFailedEmailCount()).toBe(5);
  });

  it("returns 0 when no row comes back", async () => {
    mockDbState.countRows = [];

    expect(await getFailedEmailCount()).toBe(0);
  });

  it("filters on status = 'failed'", async () => {
    mockDbState.countRows = [{ count: 2 }];

    await getFailedEmailCount();

    // drizzle-orm's eq() returns a SQL fragment whose .queryChunks include
    // the bound parameter — inspect that directly rather than
    // JSON.stringify, which throws on the fragment's circular table
    // reference (PgTable -> column -> table).
    const chunks = (mockDbState.lastWhereArg as { queryChunks?: unknown[] })
      ?.queryChunks;
    const values = JSON.stringify(chunks, (_key, value) =>
      typeof value === "object" && value !== null && "table" in value
        ? undefined
        : value
    );
    expect(values).toContain("failed");
  });

  it("also folds in the 'retrying' status, so a stranded row is visible on the badge even before something resets it — the whole point of B-66", async () => {
    mockDbState.countRows = [{ count: 1 }];

    await getFailedEmailCount();

    const chunks = (mockDbState.lastWhereArg as { queryChunks?: unknown[] })
      ?.queryChunks;
    const values = JSON.stringify(chunks, (_key, value) =>
      typeof value === "object" && value !== null && "table" in value
        ? undefined
        : value
    );
    expect(values).toContain("retrying");
  });
});

describe("resetStaleRetryingEmails — B-66 (docs/work-log/2026-09-25-retry-stranding.md)", () => {
  const NOW = new Date("2026-09-25T12:00:00.000Z");

  beforeEach(() => {
    mockDbState.retryingRows = [];
  });

  it("resets a row stranded at 'retrying' past the threshold back to 'failed', clearing its claim timestamp — fails against pre-fix code (no such function/column existed)", async () => {
    const staleAt = new Date(NOW.getTime() - (RETRY_STALE_MINUTES + 1) * 60 * 1000);
    mockDbState.retryingRows = [{ id: "stranded-1", status: "retrying", retryingAt: staleAt }];

    const count = await resetStaleRetryingEmails(NOW);

    expect(count).toBe(1);
    const row = mockDbState.retryingRows.find((r) => r.id === "stranded-1");
    expect(row?.status).toBe("failed");
    expect(row?.retryingAt).toBeNull();
  });

  it("does NOT reset a row still within the threshold — a legitimately in-flight claim must never be reset out from under itself (would reopen the duplicate-send race)", async () => {
    const freshAt = new Date(NOW.getTime() - (RETRY_STALE_MINUTES - 1) * 60 * 1000);
    mockDbState.retryingRows = [{ id: "live-1", status: "retrying", retryingAt: freshAt }];

    const count = await resetStaleRetryingEmails(NOW);

    expect(count).toBe(0);
    const row = mockDbState.retryingRows.find((r) => r.id === "live-1");
    expect(row?.status).toBe("retrying");
    expect(row?.retryingAt).toEqual(freshAt);
  });

  it("never touches a row that isn't 'retrying' at all, regardless of age", async () => {
    const ancient = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    mockDbState.retryingRows = [{ id: "already-failed", status: "failed", retryingAt: null }];

    const count = await resetStaleRetryingEmails(NOW);

    expect(count).toBe(0);
    expect(mockDbState.retryingRows[0].status).toBe("failed");
    void ancient; // documents intent — age is irrelevant for a non-retrying row
  });

  it("resets multiple stranded rows in one sweep and leaves fresh ones alone", async () => {
    const stale = new Date(NOW.getTime() - 10 * 60 * 1000);
    const fresh = new Date(NOW.getTime() - 1 * 60 * 1000);
    mockDbState.retryingRows = [
      { id: "stranded-a", status: "retrying", retryingAt: stale },
      { id: "stranded-b", status: "retrying", retryingAt: stale },
      { id: "live-a", status: "retrying", retryingAt: fresh },
    ];

    const count = await resetStaleRetryingEmails(NOW);

    expect(count).toBe(2);
    expect(mockDbState.retryingRows.find((r) => r.id === "stranded-a")?.status).toBe("failed");
    expect(mockDbState.retryingRows.find((r) => r.id === "stranded-b")?.status).toBe("failed");
    expect(mockDbState.retryingRows.find((r) => r.id === "live-a")?.status).toBe("retrying");
  });
});

describe("emailQueueRetentionCutoff", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns exactly 183 days before now", () => {
    expect(emailQueueRetentionCutoff(new Date("2026-10-13T00:00:00.000Z")).toISOString()).toBe(
      "2026-04-13T00:00:00.000Z"
    );
  });

  it("uses day arithmetic, not calendar months, so a month-end now is well-defined", () => {
    expect(emailQueueRetentionCutoff(new Date("2026-08-31T12:00:00.000Z")).toISOString()).toBe(
      "2026-03-01T12:00:00.000Z"
    );
  });

  it("is pure: does not mutate its argument, and defaults to the current time", () => {
    const arg = new Date("2026-10-13T00:00:00.000Z");
    emailQueueRetentionCutoff(arg);
    expect(arg.toISOString()).toBe("2026-10-13T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00.000Z"));
    expect(emailQueueRetentionCutoff().toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  it("EMAIL_QUEUE_RETENTION_DAYS is 183", () => {
    // Changing this requires updating the two "6 months" strings in
    // src/app/(dashboard)/admin/email-queue/page.tsx and DECISION-107.
    expect(EMAIL_QUEUE_RETENTION_DAYS).toBe(183);
  });
});

describe("pruneEmailQueue", () => {
  const NOW = new Date("2026-10-13T00:00:00.000Z");
  const CUTOFF = emailQueueRetentionCutoff(NOW);
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
  const row = (
    id: string,
    status: string,
    sentAt: Date | null,
    createdAt: Date
  ): PurgeRow => ({ id, status, sentAt, createdAt });

  beforeEach(() => {
    mockDbState.purgeRows = [];
    mockDbState.lastDeleteCond = null;
    mockDbState.deleteError = null;
    vi.mocked(db.delete).mockClear();
    vi.mocked(db.update).mockClear();
    vi.mocked(db.insert).mockClear();
  });

  it("pins the exact predicate", async () => {
    await pruneEmailQueue(NOW);

    const { sql: text, params } = new PgDialect().sqlToQuery(mockDbState.lastDeleteCond as SQL);
    expect(text).toBe(
      '("email_queue"."status" <> $1 and COALESCE("email_queue"."sent_at", "email_queue"."created_at") < $2::timestamp)'
    );
    expect(params).toEqual(["retrying", "2026-04-13T00:00:00.000Z"]);
  });

  it("keeps rows at and inside the cutoff, deletes rows older than it (strict <)", async () => {
    mockDbState.purgeRows = [
      row("older", "sent", new Date(CUTOFF.getTime() - 1), ago(300)),
      row("at", "sent", new Date(CUTOFF.getTime()), ago(300)),
      row("inside", "sent", new Date(CUTOFF.getTime() + 1), ago(300)),
      row("recent", "sent", ago(1), ago(1)),
    ];

    const count = await pruneEmailQueue(NOW);

    expect(count).toBe(1);
    expect(mockDbState.purgeRows.map((r) => r.id).sort()).toEqual(["at", "inside", "recent"]);
  });

  it("never deletes a 'retrying' row, however old", async () => {
    mockDbState.purgeRows = [
      row("retrying-old", "retrying", null, ago(400)),
      row("failed-old", "failed", null, ago(400)),
    ];

    await pruneEmailQueue(NOW);

    expect(mockDbState.purgeRows.map((r) => r.id)).toEqual(["retrying-old"]);
    const { sql: text, params } = new PgDialect().sqlToQuery(mockDbState.lastDeleteCond as SQL);
    expect(text).toContain('"email_queue"."status" <> $1');
    expect(params[0]).toBe("retrying");
  });

  it("purges every other status when old: sent, failed, pending, blocked_non_production, dev_no_api_key", async () => {
    mockDbState.purgeRows = [
      "sent",
      "failed",
      "pending",
      "blocked_non_production",
      "dev_no_api_key",
      "retrying",
    ].map((status) => row(status, status, null, ago(200)));

    const count = await pruneEmailQueue(NOW);

    expect(count).toBe(5);
    expect(mockDbState.purgeRows.map((r) => r.status)).toEqual(["retrying"]);
  });

  it("uses COALESCE(sent_at, created_at) as the age basis", async () => {
    mockDbState.purgeRows = [
      // (a) long-stranded failure that was just retried successfully: KEPT
      row("a-kept", "sent", ago(2), ago(300)),
      // (b) never sent; falls back to created_at: DELETED
      row("b-deleted", "failed", null, ago(200)),
      // (c) sent long ago: DELETED
      row("c-deleted", "sent", ago(200), ago(210)),
    ];

    await pruneEmailQueue(NOW);

    expect(mockDbState.purgeRows.map((r) => r.id)).toEqual(["a-kept"]);
    const { sql: text } = new PgDialect().sqlToQuery(mockDbState.lastDeleteCond as SQL);
    expect(text).toContain('COALESCE("email_queue"."sent_at", "email_queue"."created_at")');
    expect(text).not.toMatch(/"email_queue"\."created_at" </);
  });

  it("returns the number of rows deleted, 0 when none", async () => {
    mockDbState.purgeRows = [row("x", "sent", ago(250), ago(250)), row("y", "failed", null, ago(250))];
    expect(await pruneEmailQueue(NOW)).toBe(2);
    expect(await pruneEmailQueue(NOW)).toBe(0);
  });

  it("propagates a database error instead of swallowing it", async () => {
    mockDbState.deleteError = new Error("db down");
    await expect(pruneEmailQueue(NOW)).rejects.toThrow("db down");
  });

  it("issues exactly one DELETE on email_queue and nothing else", async () => {
    await pruneEmailQueue(NOW);

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
