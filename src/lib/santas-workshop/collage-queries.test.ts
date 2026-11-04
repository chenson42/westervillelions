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

import { getCollage, selectCollage, selectCollageTiles, type CollagePhotoRow, type CollageSceneRow } from "./collage-queries";
import { decidePhotoAccess, photoFactsFrom } from "./photo-access";

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
    expect(await getCollage(TOKEN)).toEqual({ state: "pending", practice: false, arrivesOn: "2026-12-05", scenes: [], tiles: [] });
    expect(st.queried).toBe(1);
  });

  it("a publicly purged session is removed, with no tiles and no photo query", async () => {
    st.selects = [[{ id: "s", kind: "real", photoDate: "2026-12-05", collagePublishedAt: T("12:00:00"), publicPurgedAt: T("13:00:00") }]];
    expect(await getCollage(TOKEN)).toEqual({ state: "removed", practice: false, arrivesOn: null, scenes: [], tiles: [] });
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
      [], // the session's scenes (none)
    ];
    expect(await getCollage(TOKEN)).toEqual({
      state: "live",
      practice: true,
      arrivesOn: null,
      scenes: [],
      tiles: [
        { id: "g1", kind: "group" },
        { id: "p1", kind: "portrait" },
      ],
    });
  });

  it("a published session with no photos is live and empty", async () => {
    st.selects = [[{ id: "s", kind: "real", photoDate: "2026-12-05", collagePublishedAt: T("12:00:00"), publicPurgedAt: null }], [], []];
    expect(await getCollage(TOKEN)).toEqual({ state: "live", practice: false, arrivesOn: null, scenes: [], tiles: [] });
  });
});

// ---------------------------------------------------------------------------
// Storyline grouping (DECISION-128)
// ---------------------------------------------------------------------------

/** The function as it was before the storyline existed, frozen here so "zero scenes is identical" cannot drift. */
function frozenSelectCollageTiles(rows: CollagePhotoRow[]) {
  const byTakenOld = (a: CollagePhotoRow, b: CollagePhotoRow): number => {
    const ta = (a.takenAt ?? a.createdAt).getTime();
    const tb = (b.takenAt ?? b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const visible = rows.filter((r) => (r.kind === "group" || r.kind === "portrait") && decidePhotoAccess({ kind: "public" }, r.facts, "thumb"));
  const tiles: { id: string; kind: "group" | "portrait" }[] = [];
  for (const kind of ["group", "portrait"] as const) {
    for (const r of visible.filter((v) => v.kind === kind).sort(byTakenOld)) tiles.push({ id: r.id, kind });
  }
  return tiles;
}

/** mulberry32: a small seeded generator so the property test is reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scenedRow = (id: string, sceneId: string | null, over: Parameters<typeof photo>[1] = {}): CollagePhotoRow => ({ ...photo(id, over), sceneId });
const scene = (id: string, title = `Scene ${id}`, caption: string | null = null): CollageSceneRow => ({ id, title, caption });

function randomRows(rand: () => number, sceneIds: string[]) {
  const n = Math.floor(rand() * 40);
  const rows: CollagePhotoRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const kind = (["group", "group", "portrait", "check_in"] as const)[Math.floor(rand() * 4)];
    const pick = rand();
    const sceneId = pick < 0.35 ? null : pick < 0.8 && sceneIds.length > 0 ? sceneIds[Math.floor(rand() * sceneIds.length)] : `deleted-or-foreign-${Math.floor(rand() * 3)}`;
    rows.push(
      scenedRow(`r${String(i).padStart(3, "0")}`, sceneId, {
        kind,
        taken: rand() < 0.1 ? null : T(`${String(8 + Math.floor(rand() * 6)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00`),
        hidden: rand() < 0.2,
        published: rand() < 0.75,
        consent: rand() < 0.6,
        superseded: rand() < 0.1,
        purged: rand() < 0.05,
        sessionPublished: rand() < 0.95,
      }),
    );
  }
  return rows;
}

describe("selectCollage parity (property test)", () => {
  it("scenes + tiles are exactly the set the single approval pass accepts, with no repeats, nothing refused, no empty scene, no portrait in a scene", () => {
    const rand = rng(20261204);
    for (let run = 0; run < 400; run += 1) {
      const sceneCount = Math.floor(rand() * 7);
      const scenes = Array.from({ length: sceneCount }, (_, i) => scene(`s${i}`));
      const rows = randomRows(rand, scenes.map((s) => s.id));
      const out = selectCollage(rows, scenes);

      // (a) independently computed: the door's own decision, called directly
      const accepted = rows.filter((r) => (r.kind === "group" || r.kind === "portrait") && decidePhotoAccess({ kind: "public" }, r.facts, "thumb")).map((r) => r.id).sort();
      const emitted = [...out.scenes.flatMap((s) => s.tiles.map((t) => t.id)), ...out.tiles.map((t) => t.id)];
      expect([...emitted].sort(), `run ${run}`).toEqual(accepted);

      // (b) no id twice
      expect(new Set(emitted).size).toBe(emitted.length);

      // (c) nothing the door refuses
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of emitted) expect(decidePhotoAccess({ kind: "public" }, byId.get(id)!.facts, "thumb")).toBe(true);

      // (d) no empty scene, (e) scenes hold group tiles only
      for (const s of out.scenes) {
        expect(s.tiles.length).toBeGreaterThan(0);
        for (const t of s.tiles) expect(t.kind).toBe("group");
        expect(Object.keys(s).sort()).toEqual(["caption", "tiles", "title"]);
      }
    }
  });
});

describe("zero scenes is identical to today", () => {
  it("selectCollage(rows, []).tiles deep-equals the frozen pre-change function, scenes is [], and so does selectCollageTiles", () => {
    const rand = rng(77);
    for (let run = 0; run < 300; run += 1) {
      const rows = randomRows(rand, ["s0", "s1"]); // rows may even carry scene ids: with no scenes they are ignored
      const out = selectCollage(rows, []);
      expect(out.scenes).toEqual([]);
      expect(out.tiles).toEqual(frozenSelectCollageTiles(rows));
      expect(selectCollageTiles(rows)).toEqual(frozenSelectCollageTiles(rows));
    }
  });
});

describe("grouping order", () => {
  it("scenes follow the order given (position, created_at, id is the query's job); tiles in a scene by capture time then id; unscened group tiles come last in tiles, before portraits", () => {
    const scenes = [scene("a", "Arrival", "Santa lands"), scene("b", "Workshop")];
    const rows = [
      scenedRow("b2", "b", { taken: T("10:05:00") }),
      scenedRow("a2", "a", { taken: T("10:20:00") }),
      scenedRow("a1", "a", { taken: T("10:10:00") }),
      scenedRow("b1", "b", { taken: T("10:05:00") }), // same time as b2: id breaks the tie
      scenedRow("u2", null, { taken: T("09:30:00") }),
      scenedRow("u1", null, { taken: T("09:00:00") }),
      scenedRow("p1", null, { kind: "portrait", consent: true, taken: T("08:00:00") }),
    ];
    const out = selectCollage(rows, scenes);
    expect(out.scenes).toEqual([
      { title: "Arrival", caption: "Santa lands", tiles: [{ id: "a1", kind: "group" }, { id: "a2", kind: "group" }] },
      { title: "Workshop", caption: null, tiles: [{ id: "b1", kind: "group" }, { id: "b2", kind: "group" }] },
    ]);
    expect(out.tiles.map((t) => t.id)).toEqual(["u1", "u2", "p1"]);
    // scene order is the order of the list given, whatever the photo order
    expect(selectCollage(rows, [scenes[1], scenes[0]]).scenes.map((s) => s.title)).toEqual(["Workshop", "Arrival"]);
  });

  it("a scene whose only photos are hidden, unpublished or purged is absent (no heading, no gap)", () => {
    const out = selectCollage([scenedRow("h", "a", { hidden: true }), scenedRow("n", "a", { published: false }), scenedRow("x", "a", { purged: true })], [scene("a")]);
    expect(out).toEqual({ scenes: [], tiles: [] });
  });

  it("a portrait row carrying a scene id is never put in a scene", () => {
    const out = selectCollage([scenedRow("p", "a", { kind: "portrait", consent: true })], [scene("a")]);
    expect(out.scenes).toEqual([]);
    expect(out.tiles).toEqual([{ id: "p", kind: "portrait" }]);
  });
});

describe("foreign or deleted scene id falls to tiles", () => {
  it("a photo whose scene is not in the session's scene map is an ordinary unscened tile", () => {
    const out = selectCollage([scenedRow("g1", "deleted"), scenedRow("g2", "other-session-scene"), scenedRow("g3", "a")], [scene("a")]);
    expect(out.scenes).toEqual([{ title: "Scene a", caption: null, tiles: [{ id: "g3", kind: "group" }] }]);
    expect(out.tiles.map((t) => t.id)).toEqual(["g1", "g2"]);
  });
});

describe("getCollage with a storyline", () => {
  beforeEach(() => {
    st.selects = [];
    st.queried = 0;
  });
  const base = { sessionId: "s", takenAt: T("10:00:00"), createdAt: T("09:00:00"), hiddenAt: null, supersededAt: null, purgedAt: null, publishedAt: T("11:00:00"), consent: null, stuffyId: null };
  const live = { id: "s", kind: "real", photoDate: "2026-12-05", collagePublishedAt: T("12:00:00"), publicPurgedAt: null };

  it("live: groups approved group pictures under the session's scenes and leaves the rest in tiles", async () => {
    st.selects = [
      [live],
      [
        { ...base, id: "g1", kind: "group", sceneId: "sc1" },
        { ...base, id: "g2", kind: "group", sceneId: null },
        { ...base, id: "g3", kind: "group", sceneId: "gone" },
        { ...base, id: "g4", kind: "group", sceneId: "sc1", publishedAt: null }, // not yet approved
      ],
      [{ id: "sc1", title: "Arrival", caption: "Santa lands" }],
    ];
    expect(await getCollage(TOKEN)).toEqual({
      state: "live",
      practice: false,
      arrivesOn: null,
      scenes: [{ title: "Arrival", caption: "Santa lands", tiles: [{ id: "g1", kind: "group" }] }],
      tiles: [
        { id: "g2", kind: "group" },
        { id: "g3", kind: "group" },
      ],
    });
    expect(st.queried).toBe(3);
  });

  it("pending and removed carry no scenes and never query scenes (one query: the session)", async () => {
    st.selects = [[{ ...live, collagePublishedAt: null }]];
    expect(await getCollage(TOKEN)).toMatchObject({ state: "pending", scenes: [] });
    expect(st.queried).toBe(1);
    st.queried = 0;
    st.selects = [[{ ...live, publicPurgedAt: T("13:00:00") }], [{ id: "sc1", title: "SECRET", caption: null }]];
    expect(await getCollage(TOKEN)).toMatchObject({ state: "removed", scenes: [], tiles: [] });
    expect(st.queried).toBe(1);
  });
});
