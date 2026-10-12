import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@/lib/db", () => ({ db: {} }));

import { sessionEventsFilter } from "./events-queries";

const dialect = new PgDialect();
const render = (q: SQL | undefined) => dialect.sqlToQuery(q as SQL);

const A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", campaignId: "campaign-a" };
const B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", campaignId: "campaign-b" };

describe("sessionEventsFilter (what the Connect page's Recent events list shows)", () => {
  it("matches on session_id OR campaign_id, in one predicate", () => {
    const { sql, params } = render(sessionEventsFilter(A));
    expect(sql).toContain('"zeffy_events"."session_id" = $1');
    expect(sql).toContain('"zeffy_events"."campaign_id" = $2');
    expect(sql).toMatch(/\bor\b/i);
    expect(params).toEqual([A.id, A.campaignId]);
  });

  it("lists a failed id-only event (session_id set, campaign_id NULL): the session_id arm matches it", () => {
    // The row {session_id: A.id, campaign_id: null} satisfies arm 1 regardless of arm 2.
    expect(render(sessionEventsFilter(A)).params[0]).toBe(A.id);
  });

  it("lists an event once after a retry fills campaign_id: both arms match ONE row, and a single OR returns a row once", () => {
    const { sql } = render(sessionEventsFilter(A));
    expect(sql.match(/from|join/gi)).toBeNull(); // a filter over one table cannot duplicate rows
    expect(sql.match(/\bor\b/gi)).toHaveLength(1);
  });

  it("never names another session's ids", () => {
    const a = render(sessionEventsFilter(A)).params;
    const b = render(sessionEventsFilter(B)).params;
    expect(a.some((p) => b.includes(p))).toBe(false);
  });

  it("a session with no campaign yet filters on session_id alone", () => {
    const { sql, params } = render(sessionEventsFilter({ id: A.id, campaignId: null }));
    expect(params).toEqual([A.id]);
    expect(sql).not.toMatch(/campaign_id/);
  });
});
