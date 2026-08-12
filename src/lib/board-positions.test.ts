/**
 * Unit tests for src/lib/board-positions.ts — resolveTreasurer().
 *
 * Hermetic: mocks @/lib/db (the connection module) so `pnpm test` passes
 * without DATABASE_URL/DB_URL set, same convention as
 * src/lib/minutes-queries.test.ts. @/lib/db/schema is NOT mocked — it's a
 * pure table-definition module with no env dependency, and real PgColumn
 * objects are needed for the case-insensitivity claim below to be proven
 * structurally (compiled via PgDialect) rather than just reasoned about.
 *
 * Phase 3 test 10 (docs/work-log/2026-08-12-dues-reminder-emails.md, §9):
 * zero matches -> none; exactly one -> ok:true; two or more -> multiple;
 * missing "Board of Directors" group -> no_board_group; position values
 * "Treasurer", "treasurer", " Treasurer " all match as the same single row.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    boardGroup: undefined as { id: string } | undefined,
    rows: [] as Array<{ memberId: string; firstName: string; lastName: string; email: string }>,
    wheres: [] as unknown[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      groups: {
        findFirst: () => Promise.resolve(mockDbState.boardGroup),
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (cond: unknown) => {
            mockDbState.wheres.push(cond);
            return Promise.resolve(mockDbState.rows);
          },
        }),
      }),
    }),
  },
}));

import { resolveTreasurer } from "./board-positions";

function sqlOf(cond: unknown): { sql: string; params: unknown[] } {
  const dialect = new PgDialect();
  const { sql, params } = dialect.sqlToQuery(cond as never);
  return { sql: sql.toLowerCase(), params };
}

beforeEach(() => {
  mockDbState.boardGroup = { id: "board-1" };
  mockDbState.rows = [];
  mockDbState.wheres = [];
});

describe("resolveTreasurer", () => {
  it("returns ok:false reason:no_board_group when there is no Board of Directors group", async () => {
    mockDbState.boardGroup = undefined;
    const result = await resolveTreasurer();
    expect(result).toEqual({ ok: false, reason: "no_board_group" });
  });

  it("returns ok:false reason:none on zero matches", async () => {
    mockDbState.rows = [];
    const result = await resolveTreasurer();
    expect(result).toEqual({ ok: false, reason: "none", boardGroupId: "board-1" });
  });

  it("returns ok:true with the single match", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com" },
    ];
    const result = await resolveTreasurer();
    expect(result).toEqual({
      ok: true,
      memberId: "m-1",
      firstName: "Chris",
      lastName: "Henson",
      email: "chris@example.com",
    });
  });

  it("returns ok:false reason:multiple when two or more match", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com" },
      { memberId: "m-2", firstName: "James", lastName: "Shively", email: "james@example.com" },
    ];
    const result = await resolveTreasurer();
    expect(result).toEqual({ ok: false, reason: "multiple", boardGroupId: "board-1" });
  });

  it("builds a case-insensitive, trimmed exact match against 'treasurer' — 'Treasurer', 'treasurer', ' Treasurer ' all match the same single row", async () => {
    mockDbState.rows = [
      { memberId: "m-1", firstName: "Chris", lastName: "Henson", email: "chris@example.com" },
    ];
    await resolveTreasurer();

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = sqlOf(mockDbState.wheres[0]);
    expect(sql).toContain("lower(trim(");
    expect(sql).toContain("= 'treasurer'");
  });
});
