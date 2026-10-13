import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const { st } = vi.hoisted(() => ({
  st: {
    selects: [] as Row[][],
    updates: [] as { table: string; set: Row }[],
    updateResults: [] as Row[][],
    inserts: [] as { table: string; values: Row }[],
    transactions: 0,
    failTransactionOnce: false,
  },
}));

vi.mock("@/lib/email-compose", () => ({ getAppUrl: () => "https://westervillelions.org" }));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const nameOf = (t: unknown) => (t === schema.swStuffies ? "stuffies" : t === schema.swSessionLog ? "log" : "other");
  const selectChain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            const rows = st.selects.shift() ?? [];
            return (resolve: (v: Row[]) => unknown) => resolve(rows);
          }
          return () => selectChain();
        },
      },
    );
  const writer = {
    select: () => selectChain(),
    update: (t: unknown) => ({
      set: (set: Row) => {
        st.updates.push({ table: nameOf(t), set });
        const rows = st.updateResults.shift() ?? [];
        return { where: () => ({ returning: async () => rows, then: (r: (v: unknown) => unknown) => r(undefined) }) };
      },
    }),
    insert: (t: unknown) => ({
      values: async (values: Row) => {
        st.inserts.push({ table: nameOf(t), values });
      },
    }),
  };
  return {
    db: {
      ...writer,
      transaction: async (fn: (tx: unknown) => unknown) => {
        st.transactions += 1;
        if (st.failTransactionOnce) {
          st.failTransactionOnce = false;
          throw Object.assign(new Error("dup"), { code: "23505", constraint_name: "ux_sw_stuffies_frame" });
        }
        return fn(writer);
      },
    },
  };
});

import { buildFrameManifest, exportedItemMatches, markFramesExported } from "./frame-export";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222221";
const S2 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333331";
const P2 = "33333333-3333-4333-8333-333333333332";
const USER = "44444444-4444-4444-8444-444444444444";

const sessionRow = (over: Row = {}): Row => ({
  id: SESSION_ID,
  kind: "real",
  status: "closed",
  slug: "photo-day",
  windows: [{ id: "w1", label: "9 AM", start: "09:00", end: "10:00" }],
  collageToken: "Zm9vYmFyYmF6cXV4MTIzNA",
  collagePublishedAt: null,
  publicPurgedAt: null,
  frameArtKey: "plain",
  frameFilePrefix: "",
  framePartSize: 100,
  ...over,
});
const stuffyRow = (stuffyId: string, over: Row = {}): Row => ({
  stuffyId,
  name: "Bear",
  parentFirst: "Pat",
  parentLast: "Example",
  windowId: "w1",
  consent: true,
  frameNumber: null,
  exportedPhotoId: null,
  portraitId: P1,
  portraitHiddenAt: null,
  ...over,
});

const PROD = { NODE_ENV: "production", VERCEL_ENV: "production" } as const;

beforeEach(() => {
  st.selects = [];
  st.updates = [];
  st.updateResults = [];
  st.inserts = [];
  st.transactions = 0;
  st.failTransactionOnce = false;
});

describe("buildFrameManifest", () => {
  it("is 404 for an unknown session", async () => {
    st.selects = [[]];
    expect(await buildFrameManifest(SESSION_ID, PROD)).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses a real session whose collage link is not production, before allocating anything", async () => {
    st.selects = [[sessionRow()]];
    const r = await buildFrameManifest(SESSION_ID, { NODE_ENV: "production", VERCEL_ENV: "preview" });
    expect(r).toMatchObject({ ok: false, status: 409, code: "collage_url_not_production" });
    expect(st.transactions).toBe(0);
    expect(st.updates).toHaveLength(0);
  });

  it("numbers unnumbered portraits, withholds hidden ones and returns the QR payload", async () => {
    st.selects = [
      [sessionRow()], // session
      [], // lock
      [stuffyRow(S1, { parentLast: "Zed" }), stuffyRow(S2, { parentLast: "Adams", portraitId: P2 }), stuffyRow("22222222-2222-4222-8222-222222222223", { portraitId: P2, portraitHiddenAt: new Date() })], // alloc rows
      [{ max: 0 }],
      [stuffyRow(S1, { parentLast: "Zed", frameNumber: 2 }), stuffyRow(S2, { parentLast: "Adams", portraitId: P2, frameNumber: 1 }), stuffyRow("22222222-2222-4222-8222-222222222223", { portraitId: P2, portraitHiddenAt: new Date() })], // reload
      [{ at: null }],
    ];
    const r = await buildFrameManifest(SESSION_ID, PROD);
    if ("ok" in r) throw new Error("expected a manifest");
    // Alphabetical: Adams -> 1, Zed -> 2; the hidden one is not numbered.
    expect(st.updates.map((u) => u.set.frameNumber)).toEqual([1, 2]);
    expect(r.items.map((i) => [i.stuffyId, i.frameNumber])).toEqual([[S2, 1], [S1, 2]]);
    expect(r.counts).toMatchObject({ total: 3, withPortrait: 2, hidden: 1, withoutPortrait: 0 });
    expect(r.qrPayload).toBe("https://westervillelions.org/santas-workshop/c/Zm9vYmFyYmF6cXV4MTIzNA");
    expect(r.collageUrl).toBe(r.qrPayload);
    expect(r.filePrefix).toBe("ssw-photo-day");
    expect(r.lastExportAt).toBeNull();
  });

  it("retries once when a concurrent allocation wins the unique index, then succeeds", async () => {
    st.failTransactionOnce = true;
    st.selects = [[sessionRow()], [], [stuffyRow(S1)], [{ max: 0 }], [stuffyRow(S1, { frameNumber: 1 })], [{ at: null }]];
    const r = await buildFrameManifest(SESSION_ID, PROD);
    expect("ok" in r).toBe(false);
    expect(st.transactions).toBe(2);
  });

  it("a re-run with every number already persisted writes nothing", async () => {
    const numbered = [stuffyRow(S1, { frameNumber: 1 })];
    st.selects = [[sessionRow()], [], numbered, [{ max: 1 }], numbered, [{ at: "2026-12-05T22:00:00Z" }]];
    const r = await buildFrameManifest(SESSION_ID, PROD);
    if ("ok" in r) throw new Error("expected a manifest");
    expect(st.updates).toHaveLength(0);
    expect(r.lastExportAt).toBe("2026-12-05T22:00:00.000Z");
  });

  it("manifest JSON carries no email, phone or note", async () => {
    st.selects = [[sessionRow()], [], [stuffyRow(S1)], [{ max: 0 }], [{ ...stuffyRow(S1, { frameNumber: 1 }), buyerEmail: "x@example.invalid" }], [{ at: null }]];
    const r = await buildFrameManifest(SESSION_ID, PROD);
    expect(JSON.stringify(r)).not.toMatch(/example\.invalid|buyerEmail|buyerPhone|noteToSanta|careNote|storageKey/);
  });
});

describe("markFramesExported", () => {
  const items = [
    { stuffyId: S1, photoId: P1, frameNumber: 1 },
    { stuffyId: S2, photoId: P2, frameNumber: 2 },
  ];
  const stuffies = [{ id: S1, frameNumber: 1 }, { id: S2, frameNumber: 2 }];
  const photos = [{ id: P1, stuffyId: S1, kind: "portrait" }, { id: P2, stuffyId: S2, kind: "portrait" }];

  it("stamps produced frames and logs counts only", async () => {
    st.selects = [[sessionRow()], stuffies, photos];
    st.updateResults = [[{ id: S1 }], [{ id: S2 }]];
    expect(await markFramesExported(SESSION_ID, items, true, USER)).toEqual({ marked: 2, unchanged: 0, rejected: [] });
    expect(st.updates.map((u) => u.set)).toEqual([{ frameExportedPhotoId: P1 }, { frameExportedPhotoId: P2 }]);
    expect(st.inserts).toHaveLength(1);
    expect(st.inserts[0].values.detail).toEqual({ marked: 2, unchanged: 0, rejected: 0, partial: true });
  });

  it("is idempotent: a repeat marks nothing and writes no audit row", async () => {
    st.selects = [[sessionRow()], stuffies, photos];
    st.updateResults = [[], []];
    expect(await markFramesExported(SESSION_ID, items, false, USER)).toEqual({ marked: 0, unchanged: 2, rejected: [] });
    expect(st.inserts).toHaveLength(0);
  });

  it("stamps the photo the browser used even if a retake has since superseded it, so it reads 'changed'", async () => {
    // P1 was composited; the stuffy was retaken meanwhile. The marker is P1, not the new current portrait.
    st.selects = [[sessionRow()], [stuffies[0]], [photos[0]]];
    st.updateResults = [[{ id: S1 }]];
    await markFramesExported(SESSION_ID, [items[0]], false, USER);
    expect(st.updates[0].set).toEqual({ frameExportedPhotoId: P1 });
  });

  it("rejects an item whose frame number or photo does not match, and a stuffy of another session", async () => {
    st.selects = [[sessionRow()], [stuffies[0]], [photos[0], { id: P2, stuffyId: S1, kind: "portrait" }]];
    st.updateResults = [[{ id: S1 }]];
    const r = await markFramesExported(
      SESSION_ID,
      [{ stuffyId: S1, photoId: P1, frameNumber: 1 }, { stuffyId: S2, photoId: P2, frameNumber: 2 }],
      false,
      USER,
    );
    expect(r).toEqual({ marked: 1, unchanged: 0, rejected: [S2] });
  });

  it("refuses a purged session and an oversize list", async () => {
    st.selects = [[sessionRow({ publicPurgedAt: new Date() })]];
    expect(await markFramesExported(SESSION_ID, items, false, USER)).toMatchObject({ ok: false, status: 409, code: "session_purged" });
    const many = Array.from({ length: 501 }, () => items[0]);
    expect(await markFramesExported(SESSION_ID, many, false, USER)).toMatchObject({ ok: false, status: 400 });
  });

  it("exportedItemMatches requires stuffy, number and a portrait of that stuffy", () => {
    expect(exportedItemMatches(items[0], stuffies[0], photos[0])).toBe(true);
    expect(exportedItemMatches(items[0], { id: S1, frameNumber: 9 }, photos[0])).toBe(false);
    expect(exportedItemMatches(items[0], stuffies[0], { id: P1, stuffyId: S1, kind: "check_in" })).toBe(false);
    expect(exportedItemMatches(items[0], stuffies[0], { id: P1, stuffyId: S2, kind: "portrait" })).toBe(false);
    expect(exportedItemMatches(items[0], undefined, photos[0])).toBe(false);
  });
});
