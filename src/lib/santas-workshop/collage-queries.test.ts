import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const { st } = vi.hoisted(() => ({ st: { selects: [] as Row[][], queried: 0 } }));

vi.mock("@/lib/db", () => {
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            st.queried += 1;
            const rows = st.selects.shift() ?? [];
            return (resolve: (v: Row[]) => unknown) => resolve(rows);
          }
          return () => chain();
        },
      },
    );
  return { db: { select: () => chain() } };
});

import { getCollage, selectCollageTiles, type CollagePhotoRow } from "./collage-queries";
import { photoFactsFrom } from "./photo-access";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 chars
const T = (s: string) => new Date(`2026-12-05T${s}Z`);

function photo(id: string, over: Partial<{ kind: string; taken: Date | null; hidden: boolean; published: boolean; consent: boolean; superseded: boolean; purged: boolean; sessionPublished: boolean }> = {}): CollagePhotoRow {
  const o = { kind: "group", taken: T("10:00:00"), hidden: false, published: true, consent: false, superseded: false, purged: false, sessionPublished: true, ...over };
  return {
    id,
    kind: o.kind,
    takenAt: o.taken,
    createdAt: T("09:00:00"),
    facts: photoFactsFrom({
      kind: o.kind,
      sessionId: "s",
      stuffyId: o.kind === "group" ? null : "st",
      hiddenAt: o.hidden ? T("11:00:00") : null,
      supersededAt: o.superseded ? T("11:00:00") : null,
      purgedAt: o.purged ? T("11:00:00") : null,
      publishedAt: o.published ? T("11:00:00") : null,
      consent: o.consent,
      collagePublishedAt: o.sessionPublished ? T("12:00:00") : null,
    }),
  };
}

describe("selectCollageTiles: consent and hidden filtering", () => {
  it("includes a published unhidden group photo and a consented current unhidden portrait", () => {
    const tiles = selectCollageTiles([photo("g1"), photo("p1", { kind: "portrait", consent: true })]);
    expect(tiles).toEqual([
      { id: "g1", kind: "group" },
      { id: "p1", kind: "portrait" },
    ]);
  });

  it("withholds a consented portrait taken after the last publish until the next publish stamps it", () => {
    const late = photo("p1", { kind: "portrait", consent: true, published: false });
    expect(selectCollageTiles([late])).toEqual([]);
    expect(selectCollageTiles([photo("p1", { kind: "portrait", consent: true, published: true })])).toEqual([{ id: "p1", kind: "portrait" }]);
  });

  it("withholds a portrait whose stuffy did not opt in (blank means no)", () => {
    expect(selectCollageTiles([photo("p1", { kind: "portrait", consent: false, published: false })])).toEqual([]);
  });

  it("withholds hidden photos of every kind", () => {
    expect(selectCollageTiles([photo("g1", { hidden: true }), photo("p1", { kind: "portrait", consent: true, hidden: true, published: false })])).toEqual([]);
  });

  it("withholds an unpublished group photo and a superseded or purged portrait", () => {
    expect(
      selectCollageTiles([
        photo("g1", { published: false }),
        photo("p1", { kind: "portrait", consent: true, superseded: true, published: false }),
        photo("p2", { kind: "portrait", consent: true, purged: true, published: false }),
      ]),
    ).toEqual([]);
  });

  it("never includes a check-in photo, even if every other flag would allow it", () => {
    expect(selectCollageTiles([photo("c1", { kind: "check_in", consent: true })])).toEqual([]);
  });

  it("includes nothing while the session is unpublished", () => {
    expect(selectCollageTiles([photo("g1", { sessionPublished: false })])).toEqual([]);
  });

  it("every tile is exactly { id, kind }: no name, token or storage field can ride along", () => {
    const tiles = selectCollageTiles([photo("g1"), photo("p1", { kind: "portrait", consent: true })]);
    for (const t of tiles) expect(Object.keys(t).sort()).toEqual(["id", "kind"]);
  });
});

describe("selectCollageTiles: stable order", () => {
  it("groups first, then portraits, each by capture time then id, whatever the input order", () => {
    const rows = [
      photo("p-b", { kind: "portrait", consent: true, taken: T("10:05:00") }),
      photo("g-b", { taken: T("10:10:00") }),
      photo("p-a", { kind: "portrait", consent: true, taken: T("10:05:00") }),
      photo("g-a", { taken: T("10:01:00") }),
    ];
    const expected = ["g-a", "g-b", "p-a", "p-b"];
    expect(selectCollageTiles(rows).map((t) => t.id)).toEqual(expected);
    expect(selectCollageTiles([...rows].reverse()).map((t) => t.id)).toEqual(expected);
  });
});

describe("getCollage", () => {
  beforeEach(() => {
    st.selects = [];
    st.queried = 0;
  });

  it("a malformed token is null and never reaches the database", async () => {
    for (const bad of ["", "short", "A".repeat(23), "has spaces here!!!!!!!", "../../etc/passwd", "A".repeat(21) + "+"]) {
      expect(await getCollage(bad)).toBeNull();
    }
    expect(st.queried).toBe(0);
  });

  it("an unknown token is null (the page's one identical 404)", async () => {
    st.selects = [[]];
    expect(await getCollage(TOKEN)).toBeNull();
  });

  it("unpublished is pending with the photo date and no tiles", async () => {
    st.selects = [[{ id: "s", kind: "real", photoDate: "2026-12-05", collagePublishedAt: null, publicPurgedAt: null }]];
    expect(await getCollage(TOKEN)).toEqual({ state: "pending", practice: false, arrivesOn: "2026-12-05", tiles: [] });
    expect(st.queried).toBe(1);
  });

  it("a publicly purged session is removed, with no tiles and no photo query", async () => {
    st.selects = [[{ id: "s", kind: "real", photoDate: "2026-12-05", collagePublishedAt: T("12:00:00"), publicPurgedAt: T("13:00:00") }]];
    expect(await getCollage(TOKEN)).toEqual({ state: "removed", practice: false, arrivesOn: null, tiles: [] });
    expect(st.queried).toBe(1);
  });

  it("a published session is live with filtered tiles and the practice flag", async () => {
    const base = { sessionId: "s", takenAt: T("10:00:00"), createdAt: T("09:00:00"), hiddenAt: null, supersededAt: null, purgedAt: null };
    st.selects = [
      [{ id: "s", kind: "practice", photoDate: "2026-12-05", collagePublishedAt: T("12:00:00"), publicPurgedAt: null }],
      [
        { ...base, id: "g1", kind: "group", stuffyId: null, publishedAt: T("11:00:00"), consent: null },
        { ...base, id: "g2", kind: "group", stuffyId: null, publishedAt: null, consent: null }, // unreviewed batch member
        { ...base, id: "p1", kind: "portrait", stuffyId: "st1", publishedAt: T("11:00:00"), consent: true },
        { ...base, id: "p3", kind: "portrait", stuffyId: "st3", publishedAt: null, consent: true }, // retaken after the last publish: waits
        { ...base, id: "p2", kind: "portrait", stuffyId: "st2", publishedAt: null, consent: false },
      ],
    ];
    expect(await getCollage(TOKEN)).toEqual({
      state: "live",
      practice: true,
      arrivesOn: null,
      tiles: [
        { id: "g1", kind: "group" },
        { id: "p1", kind: "portrait" },
      ],
    });
  });

  it("a published session with no photos is live and empty", async () => {
    st.selects = [[{ id: "s", kind: "real", photoDate: "2026-12-05", collagePublishedAt: T("12:00:00"), publicPurgedAt: null }], []];
    expect(await getCollage(TOKEN)).toEqual({ state: "live", practice: false, arrivesOn: null, tiles: [] });
  });
});
