/**
 * Unit tests for src/lib/welcome-packets-queries.ts.
 *
 * Covers docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3
 * (Revised) "Unit tests to write" -> "src/lib/welcome-packets-queries.ts
 * (new)", cases 1-10.
 *
 * Hermetic: mocks @/lib/db (FIFO select queue + captured insert/update
 * calls + a `transaction` that hands the same mocked client to its
 * callback), mirroring the established pattern in
 * src/lib/ledger-category-queries.test.ts and
 * src/lib/ledger-acknowledgment-letter-queries.test.ts — no real DB
 * connection, no DATABASE_URL/DB_URL required to run `pnpm test`. Schema
 * symbols (@/lib/db/schema) are imported for real — that module has no DB
 * connection side effect at import time, same precedent those two files
 * document.
 *
 * Because every read/write in this module issues its select/insert/update
 * calls in a fixed, known order (see the module's own inline comments),
 * each test pushes exactly the rows a real Postgres would return for that
 * exact call sequence onto `mockDbState.selectQueue` / `insertReturningQueue`
 * before invoking the function under test — this is what lets "case 6"
 * (the transactional mark-current correctness case) prove the pointer
 * flips correctly across two sequential publishes without a live database:
 * the test supplies what the DB would now report after each write, and
 * asserts the read functions compute `isCurrent` from it correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    wheres: [] as unknown[],
    insertCalls: [] as { table: unknown; values: Record<string, unknown> }[],
    insertReturningQueue: [] as unknown[][],
    updateCalls: [] as { table: unknown; values: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => {
  function selectChain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
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
        values: (values: Record<string, unknown>) => ({
          returning: () => {
            mockDbState.insertCalls.push({ table, values });
            return Promise.resolve(mockDbState.insertReturningQueue.shift() ?? []);
          },
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            mockDbState.updateCalls.push({ table, values });
            return Promise.resolve(undefined);
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
  createWelcomePacket,
  getCurrentWelcomePacket,
  getWelcomePacketById,
  listWelcomePackets,
  markWelcomePacketCurrent,
  updateWelcomePacket,
} from "./welcome-packets-queries";

beforeEach(() => {
  mockDbState.selectQueue = [];
  mockDbState.wheres = [];
  mockDbState.insertCalls = [];
  mockDbState.insertReturningQueue = [];
  mockDbState.updateCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const NOW = new Date("2026-08-21T12:00:00.000Z");

const validHtml = `<title>Welcome Packet 2026-27</title>
<style>
  :root { --ink: #17203A; }
  body { background: var(--paper); }
</style>
<div class="deck">
<section class="slide"><h1>Welcome</h1></section>
</div>
`;

const malformedHtml = `<title>Broken Packet</title>\n<p>no style, no deck</p>\n`;

function packetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "packet-a",
    lionsYear: "2026-27",
    rawHtml: validHtml,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createWelcomePacket
// ---------------------------------------------------------------------------

describe("createWelcomePacket", () => {
  it("case 1: valid input succeeds and the row is readable back via getWelcomePacketById with isCurrent: false", async () => {
    mockDbState.insertReturningQueue.push([{ id: "packet-a" }]);

    const result = await createWelcomePacket({
      lionsYear: "2026-27",
      rawHtml: validHtml,
      createdByUserId: "user-1",
    });

    expect(result).toEqual({ ok: true, id: "packet-a" });
    expect(mockDbState.insertCalls).toHaveLength(1);
    expect(mockDbState.insertCalls[0].values).toMatchObject({
      lionsYear: "2026-27",
      rawHtml: validHtml,
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
    });

    // Readable back: select welcomePackets by id, then getCurrentPacketId.
    mockDbState.selectQueue.push([packetRow({ createdByUserId: "user-1", updatedByUserId: "user-1" })]);
    mockDbState.selectQueue.push([{ packetId: null }]); // nothing marked current yet

    const detail = await getWelcomePacketById("packet-a");
    expect(detail).not.toBeNull();
    expect(detail?.lionsYear).toBe("2026-27");
    expect(detail?.rawHtml).toBe(validHtml);
    expect(detail?.isCurrent).toBe(false);
  });

  it("case 2: invalid lionsYear is rejected without writing", async () => {
    const result = await createWelcomePacket({
      lionsYear: "2027",
      rawHtml: validHtml,
      createdByUserId: null,
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_lions_year",
      message: expect.stringContaining("YYYY-YY"),
    });
    expect(mockDbState.insertCalls).toHaveLength(0);
  });

  it("case 3: malformed rawHtml (missing an anchor) is rejected without writing", async () => {
    const result = await createWelcomePacket({
      lionsYear: "2026-27",
      rawHtml: malformedHtml,
      createdByUserId: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("parse_error");
      expect(result.message).toContain("missing expected anchor(s)");
      expect(result.message).toContain("<style>");
      expect(result.message).toContain('<div class="deck">');
    }
    expect(mockDbState.insertCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// updateWelcomePacket
// ---------------------------------------------------------------------------

describe("updateWelcomePacket", () => {
  it("case 4: edits an existing row in place — no new row is created", async () => {
    const newRawHtml = validHtml.replace("Welcome Packet 2026-27", "Welcome Packet 2026-27 (revised)");

    const result = await updateWelcomePacket("packet-a", {
      lionsYear: "2026-27",
      rawHtml: newRawHtml,
      updatedByUserId: "user-2",
    });

    expect(result).toEqual({ ok: true, id: "packet-a" });
    expect(mockDbState.insertCalls).toHaveLength(0); // no new row
    expect(mockDbState.updateCalls).toHaveLength(1);
    expect(mockDbState.updateCalls[0].values).toMatchObject({
      lionsYear: "2026-27",
      rawHtml: newRawHtml,
      updatedByUserId: "user-2",
    });

    // Confirm the id is unchanged and the new content is what's readable back.
    mockDbState.selectQueue.push([packetRow({ rawHtml: newRawHtml, updatedByUserId: "user-2" })]);
    mockDbState.selectQueue.push([{ packetId: null }]);
    const detail = await getWelcomePacketById("packet-a");
    expect(detail?.id).toBe("packet-a");
    expect(detail?.rawHtml).toBe(newRawHtml);
  });

  it("case 5: same validation rejections as create — invalid lionsYear, no write", async () => {
    const result = await updateWelcomePacket("packet-a", {
      lionsYear: "not-a-year",
      rawHtml: validHtml,
      updatedByUserId: null,
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_lions_year",
      message: expect.stringContaining("YYYY-YY"),
    });
    expect(mockDbState.updateCalls).toHaveLength(0);
  });

  it("case 5b: same validation rejections as create — parse_error, no write", async () => {
    const result = await updateWelcomePacket("packet-a", {
      lionsYear: "2026-27",
      rawHtml: malformedHtml,
      updatedByUserId: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parse_error");
    expect(mockDbState.updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// markWelcomePacketCurrent
// ---------------------------------------------------------------------------

describe("markWelcomePacketCurrent", () => {
  it("case 6: the singleton pointer flips correctly across two sequential publishes", async () => {
    const packetARow = packetRow({ id: "packet-a", lionsYear: "2026-27" });
    const packetBRow = packetRow({ id: "packet-b", lionsYear: "2027-28" });

    // ── Mark A current ──────────────────────────────────────────────────
    mockDbState.selectQueue.push([{ id: "packet-a" }]); // tx: welcomePackets existence check
    mockDbState.selectQueue.push([{ id: "singleton-1" }]); // tx: singleton row lookup
    const resultA = await markWelcomePacketCurrent("packet-a", "user-1");
    expect(resultA).toEqual({ ok: true });
    expect(mockDbState.updateCalls).toHaveLength(1);
    expect(mockDbState.updateCalls[0].values).toMatchObject({ packetId: "packet-a", setByUserId: "user-1" });

    // getWelcomePacketById(A) reflects isCurrent: true.
    mockDbState.selectQueue.push([packetARow]);
    mockDbState.selectQueue.push([{ packetId: "packet-a" }]);
    expect((await getWelcomePacketById("packet-a"))?.isCurrent).toBe(true);

    // getCurrentWelcomePacket() resolves to A.
    mockDbState.selectQueue.push([{ packetId: "packet-a" }]);
    mockDbState.selectQueue.push([packetARow]);
    expect((await getCurrentWelcomePacket())?.packetId).toBe("packet-a");

    // ── Mark B current ──────────────────────────────────────────────────
    mockDbState.selectQueue.push([{ id: "packet-b" }]);
    mockDbState.selectQueue.push([{ id: "singleton-1" }]);
    const resultB = await markWelcomePacketCurrent("packet-b", "user-2");
    expect(resultB).toEqual({ ok: true });
    expect(mockDbState.updateCalls).toHaveLength(2);
    expect(mockDbState.updateCalls[1].values).toMatchObject({ packetId: "packet-b", setByUserId: "user-2" });

    // A flips to isCurrent: false, B becomes isCurrent: true — the
    // one-column-can-only-hold-one-value property, proven across two writes.
    mockDbState.selectQueue.push([packetARow]);
    mockDbState.selectQueue.push([{ packetId: "packet-b" }]);
    expect((await getWelcomePacketById("packet-a"))?.isCurrent).toBe(false);

    mockDbState.selectQueue.push([packetBRow]);
    mockDbState.selectQueue.push([{ packetId: "packet-b" }]);
    expect((await getWelcomePacketById("packet-b"))?.isCurrent).toBe(true);

    mockDbState.selectQueue.push([{ packetId: "packet-b" }]);
    mockDbState.selectQueue.push([packetBRow]);
    expect((await getCurrentWelcomePacket())?.packetId).toBe("packet-b");
  });

  it("case 7: an unknown id returns not_found and never touches the singleton pointer", async () => {
    mockDbState.selectQueue.push([]); // tx: welcomePackets existence check finds nothing

    const result = await markWelcomePacketCurrent("does-not-exist", null);

    expect(result).toEqual({ ok: false, reason: "not_found" });
    // No UPDATE was ever issued — the strongest available proof, at the unit
    // level, that a failed mark-current cannot leave the pointer in an
    // inconsistent or cleared state: it simply never writes.
    expect(mockDbState.updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getCurrentWelcomePacket
// ---------------------------------------------------------------------------

describe("getCurrentWelcomePacket", () => {
  it("case 8: returns null when the singleton's packetId is null", async () => {
    mockDbState.selectQueue.push([{ packetId: null }]);

    const result = await getCurrentWelcomePacket();

    expect(result).toBeNull();
  });

  it("case 9: returns null and logs console.error when the current packet's rawHtml fails to parse", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const malformedRow = packetRow({ id: "packet-bad", rawHtml: malformedHtml });

    mockDbState.selectQueue.push([{ packetId: "packet-bad" }]);
    mockDbState.selectQueue.push([malformedRow]);

    const result = await getCurrentWelcomePacket();

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("packet-bad");
  });
});

// ---------------------------------------------------------------------------
// listWelcomePackets
// ---------------------------------------------------------------------------

describe("listWelcomePackets", () => {
  it("case 10: never includes rawHtml in its result shape", async () => {
    mockDbState.selectQueue.push([{ packetId: null }]); // getCurrentPacketId
    mockDbState.selectQueue.push([
      {
        id: "packet-a",
        lionsYear: "2026-27",
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const rows = await listWelcomePackets();

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("rawHtml");
    expect(rows[0].isCurrent).toBe(false);
  });
});
