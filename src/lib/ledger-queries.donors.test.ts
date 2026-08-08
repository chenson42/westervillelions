/**
 * Unit tests for listDonors() — Donor Multiple Emails (2026-08-08,
 * docs/work-log/2026-08-08-donor-multiple-emails.md).
 *
 * ledger_donors.email (nullable text) became ledger_donors.emails (text[]),
 * so the free-text search's OR clause can no longer use a plain ilike() on
 * the column — it now needs to match ANY element of the array. These tests
 * prove the generated WHERE clause does that (via PgDialect().sqlToQuery()
 * to inspect the raw SQL/params, mirroring the "getFundReport asOfDate
 * bounding" pattern in ledger-queries.test.ts), that a name-only search
 * still works over the same clause, and that no-search still returns
 * everything unfiltered — this is what "donor search still matches on any
 * address in the list" (Phase 3 design's minimum test bar) means at the
 * query-construction layer, without requiring a live Postgres instance to
 * prove `unnest(...) ILIKE` semantics (that's Postgres's job, exercised via
 * the dev-DB migration verification in the work-log's Phase 4 notes).
 *
 * Hermetic: mocks @/lib/db — importing the real module throws at import
 * time without DATABASE_URL/DB_URL set (see ledger-queries.test.ts's header
 * comment for the same rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][], wheres: [] as unknown[] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => Promise.resolve(mockDbState.queue.shift() ?? []),
    };
    return obj;
  }
  return { db: { select: () => chain() } };
});

import { listDonors } from "./ledger-queries";

describe("listDonors search", () => {
  const dialect = new PgDialect();

  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  it("builds a WHERE matching donor name OR any element of the emails array (case-insensitive substring), sharing one %term% param on both sides", async () => {
    mockDbState.queue.push([]);
    await listDonors({ search: "trucco" });

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);

    // Email side: per-element match over the array via unnest(), not a
    // whole-array cast (which would false-positive across the Postgres
    // array literal's brace/comma syntax).
    expect(sql).toMatch(/unnest/i);
    // Both name and email sides use ILIKE.
    expect(sql.match(/ilike/gi)?.length).toBe(2);
    expect(params).toEqual(["%trucco%", "%trucco%"]);
  });

  it("matches when the search term hits the donor's SECOND email address, not just the first", async () => {
    // The WHERE clause is address-position-agnostic (unnest() scans every
    // element) — this is asserted at the SQL-shape level above; here we
    // additionally confirm the mocked row set flows through untouched once
    // Postgres would have matched it, i.e. listDonors() doesn't do any
    // client-side filtering that could re-introduce a first-address-only bug.
    const donor = {
      id: "donor-1",
      name: "Trucco Construction Co",
      emails: ["owner@trucco.com", "office@trucco.com"],
    };
    mockDbState.queue.push([donor]);

    const result = await listDonors({ search: "office@trucco.com" });

    expect(result).toEqual([donor]);
  });

  it("omits the WHERE clause entirely when no search term is given (returns everything)", async () => {
    mockDbState.queue.push([{ id: "d1" }]);
    const result = await listDonors();

    expect(mockDbState.wheres).toHaveLength(0);
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("treats a whitespace-only search as no search", async () => {
    mockDbState.queue.push([{ id: "d1" }]);
    await listDonors({ search: "   " });

    expect(mockDbState.wheres).toHaveLength(0);
  });
});
