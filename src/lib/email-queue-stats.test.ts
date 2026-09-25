/**
 * Unit tests for getFailedEmailCount(), which backs the admin nav's
 * failed-email-count badge (Phase 6 follow-up #1,
 * docs/work-log/2026-09-25-email-silent-success.md).
 *
 * Hermetic: mocks @/lib/db — importing the real module throws at import time
 * without DATABASE_URL (same rationale as src/lib/ledger-queries.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    rows: [{ count: 0 }] as { count: number }[],
    lastWhereArg: null as unknown,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: (arg: unknown) => {
          mockDbState.lastWhereArg = arg;
          return Promise.resolve(mockDbState.rows);
        },
      }),
    })),
  },
}));

import { getFailedEmailCount } from "./email-queue-stats";

describe("getFailedEmailCount", () => {
  beforeEach(() => {
    mockDbState.rows = [{ count: 0 }];
    mockDbState.lastWhereArg = null;
  });

  it("returns the count from the query result", async () => {
    mockDbState.rows = [{ count: 5 }];

    expect(await getFailedEmailCount()).toBe(5);
  });

  it("returns 0 when no row comes back", async () => {
    mockDbState.rows = [];

    expect(await getFailedEmailCount()).toBe(0);
  });

  it("filters on status = 'failed'", async () => {
    mockDbState.rows = [{ count: 2 }];

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
});
