import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const { st } = vi.hoisted(() => ({
  st: {
    selects: [] as Row[][],
    updates: [] as { table: string; set: Row }[],
    updateResults: [] as Row[][],
    inserts: [] as { table: string; values: Row }[],
    transactions: 0,
  },
}));

vi.mock("@/lib/email-compose", () => ({ getAppUrl: () => "https://example.invalid" }));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const nameOf = (t: unknown) => (t === schema.swPhotos ? "photos" : t === schema.swSessions ? "sessions" : t === schema.swSessionLog ? "log" : "other");
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
    update: (t: unknown) => ({
      set: (set: Row) => {
        st.updates.push({ table: nameOf(t), set });
        const rows = st.updateResults.shift() ?? [];
        const done = { returning: async () => rows, then: (r: (v: unknown) => unknown) => r(undefined) };
        return { where: () => done };
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
      select: () => selectChain(),
      ...writer,
      transaction: async (fn: (tx: unknown) => unknown) => {
        st.transactions += 1;
        return fn(writer);
      },
    },
  };
});

import { PgDialect } from "drizzle-orm/pg-core";
import { collageUrl, markGroupPhotosReviewed, needsPublishFor, reviewCoveredSql, reviewCutoffSql, setCollagePublished, setPhotoHidden } from "./photo-admin";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNA";
const NOW = new Date("2026-12-05T22:00:00Z");

const sessionRow = (over: Row = {}): Row => ({
  id: SESSION_ID,
  kind: "real",
  status: "active",
  collageToken: TOKEN,
  collagePublishedAt: null,
  publicPurgedAt: null,
  ...over,
});
const counts = (over: Row = {}): Row => ({
  groupTotal: 0, groupHidden: 0, groupUnreviewed: 0, groupPublished: 0, portraitsCurrent: 0, portraitsHidden: 0, portraitsOnCollage: 0, portraitsNotConsented: 0, newestGroupAt: null, newestGroupPhotoId: null, awaitingPublish: 0, portraitsAwaitingPublish: 0, ...over,
});
const logs = () => st.inserts.filter((i) => i.table === "log").map((i) => i.values);

beforeEach(() => {
  st.selects = [];
  st.updates = [];
  st.updateResults = [];
  st.inserts = [];
  st.transactions = 0;
});

describe("collageUrl", () => {
  it("is the app origin, the fixed path and the token; the QR payload is that exact string", () => {
    expect(collageUrl(TOKEN)).toBe(`https://example.invalid/santas-workshop/c/${TOKEN}`);
  });
});

describe("setPhotoHidden", () => {
  it("hides a photo, stamps who and when, and writes one audit row with ids only", async () => {
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "group", hiddenAt: null, purgedAt: null, publishedAt: null, consent: null }]];
    st.updateResults = [[{ id: PHOTO_ID }]];
    const r = await setPhotoHidden(PHOTO_ID, true, "user-1", NOW);
    expect(r).toEqual({ photo: { id: PHOTO_ID, kind: "group", hidden: true }, noop: false, needsPublish: false });
    expect(st.updates[0].set).toEqual({ hiddenAt: NOW, hiddenByUserId: "user-1" });
    expect(logs()).toEqual([{ sessionId: SESSION_ID, userId: "user-1", kind: "photo_hidden", detail: { photoId: PHOTO_ID, photoKind: "group" } }]);
  });

  it("unhides, clearing both columns, and audits photo_unhidden", async () => {
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "portrait", hiddenAt: NOW, purgedAt: null, publishedAt: null, consent: null }]];
    st.updateResults = [[{ id: PHOTO_ID }]];
    const r = await setPhotoHidden(PHOTO_ID, false, "user-1", NOW);
    expect("noop" in r && r.noop).toBe(false);
    expect(st.updates[0].set).toEqual({ hiddenAt: null, hiddenByUserId: null });
    expect(logs().map((l) => l.kind)).toEqual(["photo_unhidden"]);
  });

  it("already in the requested state is a no-op with no write and no audit row", async () => {
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "group", hiddenAt: NOW, purgedAt: null, publishedAt: null, consent: null }]];
    const r = await setPhotoHidden(PHOTO_ID, true, "user-1", NOW);
    expect("noop" in r && r.noop).toBe(true);
    expect(st.updates).toHaveLength(0);
    expect(logs()).toHaveLength(0);
  });

  it("a concurrent toggle (zero rows from the pinned update) is a no-op and writes no second audit row", async () => {
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "group", hiddenAt: null, purgedAt: null, publishedAt: null, consent: null }]];
    st.updateResults = [[]];
    const r = await setPhotoHidden(PHOTO_ID, true, "user-1", NOW);
    expect("noop" in r && r.noop).toBe(true);
    expect(logs()).toHaveLength(0);
  });

  it("unknown and purged photos are the same 404", async () => {
    st.selects = [[]];
    const a = await setPhotoHidden(PHOTO_ID, true, "user-1", NOW);
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "group", hiddenAt: null, purgedAt: NOW }]];
    const b = await setPhotoHidden(PHOTO_ID, true, "user-1", NOW);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });
});

const NEWEST = "33333333-3333-4333-8333-333333333333";

describe("needsPublish after an unhide (S3-N3)", () => {
  it("is true for a never-published group photo or consented portrait that is unhidden", () => {
    expect(needsPublishFor({ hidden: false, publishedAt: null, kind: "group", consent: false })).toBe(true);
    expect(needsPublishFor({ hidden: false, publishedAt: null, kind: "portrait", consent: true })).toBe(true);
  });
  it("is false when hidden, already published, an unconsented portrait, or a check-in photo", () => {
    expect(needsPublishFor({ hidden: true, publishedAt: null, kind: "group", consent: false })).toBe(false);
    expect(needsPublishFor({ hidden: false, publishedAt: NOW, kind: "group", consent: false })).toBe(false);
    expect(needsPublishFor({ hidden: false, publishedAt: null, kind: "portrait", consent: false })).toBe(false);
    expect(needsPublishFor({ hidden: false, publishedAt: null, kind: "check_in", consent: true })).toBe(false);
  });

  it("the unhide response carries needsPublish: true for a hidden-before-publish photo, and the hide response false", async () => {
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "group", hiddenAt: NOW, purgedAt: null, publishedAt: null, consent: null }]];
    st.updateResults = [[{ id: PHOTO_ID }]];
    expect(await setPhotoHidden(PHOTO_ID, false, "user-1", NOW)).toMatchObject({ noop: false, needsPublish: true });
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "group", hiddenAt: null, purgedAt: null, publishedAt: null, consent: null }]];
    st.updateResults = [[{ id: PHOTO_ID }]];
    expect(await setPhotoHidden(PHOTO_ID, true, "user-1", NOW)).toMatchObject({ noop: false, needsPublish: false });
  });

  it("an unhidden photo that was already published does not need a publish", async () => {
    st.selects = [[{ id: PHOTO_ID, sessionId: SESSION_ID, kind: "portrait", hiddenAt: NOW, purgedAt: null, publishedAt: NOW, consent: true }]];
    st.updateResults = [[{ id: PHOTO_ID }]];
    expect(await setPhotoHidden(PHOTO_ID, false, "user-1", NOW)).toMatchObject({ needsPublish: false });
  });
});

describe("late portraits ride the publish batch", () => {
  it("the stamping UPDATE covers consented portraits and the late count includes them (rendered SQL)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./photo-admin.ts", import.meta.url), "utf8");
    expect(src).toMatch(/and\(eq\(swPhotos\.kind, "portrait"\), sql`exists \(select 1 from sw_stuffies sc where sc\.id = \$\{swPhotos\.stuffyId\} and sc\.photo_consent\)`\)/);
    expect(src).toMatch(/portraitsAwaitingPublish: sql/);
  });

  it("a publish after a retake reports the portrait in newlyPublished and the response counts", async () => {
    st.selects = [[sessionRow({ collagePublishedAt: NOW })], [{ n: 0 }], [{ t: "2026-12-19 14:05:00.500711+00" }], [counts({ awaitingPublish: 0, portraitsAwaitingPublish: 0 })]];
    st.updateResults = [[sessionRow({ collagePublishedAt: NOW })], [{ id: "retaken-portrait" }]];
    const r = await setCollagePublished(SESSION_ID, "publish", "user-1", new Date("2026-12-19T23:00:00Z"));
    expect(r).toMatchObject({ newlyPublished: 1, noop: false });
    expect(logs()).toEqual([expect.objectContaining({ kind: "collage_published", detail: { photosPublished: 1, first: false } })]);
  });
});

describe("markGroupPhotosReviewed", () => {
  it("records the newest photo id the admin saw (never a timestamp), with counts only", async () => {
    st.selects = [[sessionRow()], [{ id: NEWEST }], [counts({ groupTotal: 4, groupHidden: 1 })], [counts()], [{ t: "2026-12-19 14:05:00.500711+00" }]];
    const r = await markGroupPhotosReviewed(SESSION_ID, NEWEST, "user-1");
    // The display value is the database's own text, microseconds intact; it is not parsed.
    expect("collage" in r && r.collage.reviewedThrough).toBe("2026-12-19 14:05:00.500711+00");
    expect(logs()).toEqual([
      { sessionId: SESSION_ID, userId: "user-1", kind: "group_photos_reviewed", detail: { throughPhotoId: NEWEST, groupTotal: 4, groupHidden: 1 } },
    ]);
  });

  it("a through photo that is not a group photo of this session is a 400 and writes nothing", async () => {
    st.selects = [[sessionRow()], []];
    expect(await markGroupPhotosReviewed(SESSION_ID, NEWEST, "user-1")).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
    expect(logs()).toHaveLength(0);
  });

  it("refuses a publicly purged session", async () => {
    st.selects = [[sessionRow({ publicPurgedAt: NOW })]];
    expect(await markGroupPhotosReviewed(SESSION_ID, NEWEST, "user-1")).toMatchObject({ ok: false, code: "session_purged" });
    expect(logs()).toHaveLength(0);
  });
});

describe("the review cutoff is compared in SQL, never through a JS Date (S3-D1)", () => {
  const dialect = new PgDialect();

  it("the cutoff is a subselect of the stored photo's own created_at, bound only to the session id", () => {
    const q = dialect.sqlToQuery(reviewCutoffSql(SESSION_ID));
    expect(q.sql).toMatch(/select max\(rp\.created_at\) from sw_photos rp/);
    expect(q.sql).toMatch(/l\.detail->>'throughPhotoId'/);
    expect(q.params).toEqual([SESSION_ID, SESSION_ID]);
    for (const p of q.params) expect(p).not.toBeInstanceOf(Date);
  });

  it("'covered' compares the photo's stored created_at with that subselect: no timestamp parameter exists to truncate", () => {
    const q = dialect.sqlToQuery(reviewCoveredSql(SESSION_ID));
    expect(q.sql).toMatch(/coalesce\("sw_photos"\."created_at" <= \(/);
    expect(q.params.every((p) => typeof p === "string" && /^[0-9a-f-]{36}$/.test(p))).toBe(true);
  });

  it("a micro-second photo time (.500711) cannot be made to differ from itself: nothing in the review path parses a timestamp", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./photo-admin.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/Date\.parse|\blte\(|::timestamptz/);
    expect(src).not.toMatch(/latestReviewCutoff|parseReviewThrough|isGroupPhotoReviewed/);
  });
});

describe("setCollagePublished", () => {
  it("refuses to publish while a group photo is unreviewed: 409 photos_unreviewed with the count, nothing written", async () => {
    st.selects = [[sessionRow()], [{ n: 3 }]];
    const r = await setCollagePublished(SESSION_ID, "publish", "user-1", NOW);
    expect(r).toMatchObject({ ok: false, status: 409, code: "photos_unreviewed", count: 3 });
    expect(st.updates).toHaveLength(0);
    expect(st.transactions).toBe(0);
    expect(logs()).toHaveLength(0);
  });

  it("publishes after a review: stamps the session and the reviewed photos in one transaction and audits", async () => {
    st.selects = [[sessionRow()], [{ n: 0 }], [{ t: "2026-12-19 14:05:00.500711+00" }], [counts({ groupTotal: 2, groupPublished: 2 })]];
    st.updateResults = [[sessionRow({ collagePublishedAt: NOW })], [{ id: "a" }, { id: "b" }]];
    const r = await setCollagePublished(SESSION_ID, "publish", "user-1", NOW);
    expect(r).toMatchObject({ newlyPublished: 2, noop: false, collage: { published: true, publishedAt: NOW.toISOString(), reviewedThrough: "2026-12-19 14:05:00.500711+00" } });
    expect(st.transactions).toBe(1);
    expect(st.updates.map((u) => u.table)).toEqual(["sessions", "photos"]);
    expect(st.updates[0].set).toMatchObject({ collagePublishedAt: NOW });
    expect(st.updates[1].set).toEqual({ publishedAt: NOW });
    expect(logs()).toEqual([{ sessionId: SESSION_ID, userId: "user-1", kind: "collage_published", detail: { photosPublished: 2, first: true } }]);
  });

  it("publishes a session with no group photos at all (zero photos is allowed)", async () => {
    st.selects = [[sessionRow()], [{ n: 0 }], [{ t: null }], [counts()]];
    st.updateResults = [[sessionRow({ collagePublishedAt: NOW })], []];
    const r = await setCollagePublished(SESSION_ID, "publish", "user-1", NOW);
    expect(r).toMatchObject({ newlyPublished: 0, noop: false, collage: { published: true, reviewedThrough: null } });
  });

  it("publishing again with nothing new is a no-op and keeps the original publish time", async () => {
    const first = new Date("2026-12-05T20:00:00Z");
    st.selects = [[sessionRow({ collagePublishedAt: first })], [{ n: 0 }], [{ t: "2026-12-05 20:00:00+00" }], [counts()]];
    st.updateResults = [[sessionRow({ collagePublishedAt: first })], []];
    const r = await setCollagePublished(SESSION_ID, "publish", "user-1", NOW);
    expect(r).toMatchObject({ noop: true, newlyPublished: 0, collage: { publishedAt: first.toISOString() } });
    expect(st.updates[0].set).toMatchObject({ collagePublishedAt: first });
    expect(logs()).toHaveLength(0);
  });

  it("unpublish clears the switch and audits; unpublishing an unpublished collage is a no-op", async () => {
    st.selects = [[sessionRow({ collagePublishedAt: NOW })], [{ t: null }], [counts()]];
    st.updateResults = [[sessionRow({ collagePublishedAt: null })]];
    const r = await setCollagePublished(SESSION_ID, "unpublish", "user-1", NOW);
    expect(r).toMatchObject({ noop: false, collage: { published: false, publishedAt: null } });
    expect(logs().map((l) => l.kind)).toEqual(["collage_unpublished"]);

    st.inserts = [];
    st.selects = [[sessionRow()], [{ t: null }], [counts()]];
    const again = await setCollagePublished(SESSION_ID, "unpublish", "user-1", NOW);
    expect(again).toMatchObject({ noop: true });
    expect(logs()).toHaveLength(0);
  });

  it("a purged session can be neither published nor unpublished; an unknown one is 404", async () => {
    st.selects = [[sessionRow({ publicPurgedAt: NOW })]];
    expect(await setCollagePublished(SESSION_ID, "publish", "u", NOW)).toMatchObject({ ok: false, code: "session_purged" });
    st.selects = [[]];
    expect(await setCollagePublished(SESSION_ID, "publish", "u", NOW)).toMatchObject({ ok: false, status: 404 });
  });
});
