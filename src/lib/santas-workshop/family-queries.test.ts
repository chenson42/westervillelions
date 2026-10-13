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

import { getFamilyView, resolveFamilyPortrait } from "./family-queries";

const TOKEN = "BBBBBBBBBBBBBBBBBBBBBB"; // 22 chars
const COLLAGE = "CCCCCCCCCCCCCCCCCCCCCC";
const T = (s: string) => new Date(`2026-12-05T${s}Z`);

const stuffy = (over: Row = {}): Row => ({
  stuffyId: "st-1",
  stuffyName: "Mr. Fluff",
  withdrawnAt: null,
  sessionId: "s-1",
  kind: "real",
  photoDate: "2026-12-05",
  collageToken: COLLAGE,
  collagePublishedAt: T("12:00:00"),
  personalPurgedAt: null,
  publicPurgedAt: null,
  ...over,
});
const portrait = (over: Row = {}): Row => ({ id: "photo-1", hiddenAt: null, publishedAt: null, purgedAt: null, ...over });

beforeEach(() => {
  st.selects = [];
  st.queried = 0;
});

describe("getFamilyView", () => {
  it("shows the stuffy's own portrait even though the family did not agree to sharing and no publish batch stamped it", async () => {
    // The stuffy row carries no consent at all, and the portrait row has publishedAt null (a late or retaken portrait).
    st.selects = [[stuffy()], [portrait({ publishedAt: null })]];
    const v = await getFamilyView(TOKEN);
    expect(v).toEqual({
      collage: "live",
      practice: false,
      stuffyName: "Mr. Fluff",
      arrivesOn: null,
      portrait: { state: "available", version: "photo-1" },
      collagePath: `/santas-workshop/c/${COLLAGE}`,
    });
  });

  it("S5-D1: the family sees its own portrait BEFORE the collage is published; only the collage link waits", async () => {
    st.selects = [[stuffy({ collagePublishedAt: null })], [portrait()]];
    expect(await getFamilyView(TOKEN)).toMatchObject({
      collage: "pending",
      arrivesOn: "2026-12-05",
      collagePath: null,
      portrait: { state: "available", version: "photo-1" },
    });
  });

  it("pending with a hidden portrait withholds it, and with none says none", async () => {
    st.selects = [[stuffy({ collagePublishedAt: null })], [portrait({ hiddenAt: T("13:00:00") })]];
    expect((await getFamilyView(TOKEN))?.portrait).toEqual({ state: "unavailable" });
    st.selects = [[stuffy({ collagePublishedAt: null })], []];
    expect(await getFamilyView(TOKEN)).toMatchObject({ collage: "pending", portrait: { state: "none" } });
  });

  it("is removed after the public purge: no portrait, no collage link, no portrait query", async () => {
    st.selects = [[stuffy({ publicPurgedAt: T("13:00:00") })]];
    expect(await getFamilyView(TOKEN)).toMatchObject({ collage: "removed", collagePath: null, portrait: { state: "none" } });
    expect(st.queried).toBe(1);
  });

  it("a hidden portrait is 'unavailable' (never served), a stuffy without one is 'none'", async () => {
    st.selects = [[stuffy()], [portrait({ hiddenAt: T("13:00:00") })]];
    expect((await getFamilyView(TOKEN))?.portrait).toEqual({ state: "unavailable" });
    st.selects = [[stuffy()], []];
    expect((await getFamilyView(TOKEN))?.portrait).toEqual({ state: "none" });
  });

  it("marks a practice session so the page can show its PRACTICE banner", async () => {
    st.selects = [[stuffy({ kind: "practice" })], []];
    expect((await getFamilyView(TOKEN))?.practice).toBe(true);
  });

  it("unknown, malformed, wrong-length and withdrawn tokens are all the same null; a malformed one never reaches the database", async () => {
    st.selects = [[]];
    expect(await getFamilyView(TOKEN)).toBeNull(); // unknown
    st.selects = [[stuffy({ withdrawnAt: T("11:00:00") })]];
    expect(await getFamilyView(TOKEN)).toBeNull(); // withdrawn
    st.queried = 0;
    for (const bad of ["", "short", "A".repeat(23), "A".repeat(21) + "!", "../../etc/passwd", "A".repeat(21) + " "]) {
      expect(await getFamilyView(bad)).toBeNull();
    }
    expect(await getFamilyView(undefined as unknown as string)).toBeNull();
    expect(st.queried).toBe(0);
  });
});

describe("resolveFamilyPortrait (the portrait door's lookup)", () => {
  it("returns the stuffy and its current portrait id; the door still decides hidden and purged", async () => {
    st.selects = [[stuffy()], [portrait({ hiddenAt: T("13:00:00") })]];
    expect(await resolveFamilyPortrait(TOKEN)).toEqual({ stuffyId: "st-1", photoId: "photo-1" });
  });

  it("is null for an unknown token, a withdrawn stuffy or no portrait", async () => {
    st.selects = [[]];
    expect(await resolveFamilyPortrait(TOKEN)).toBeNull();
    st.selects = [[stuffy()], []];
    expect(await resolveFamilyPortrait(TOKEN)).toBeNull();
    expect(await resolveFamilyPortrait("nope")).toBeNull();
  });
});
