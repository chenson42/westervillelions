/** The anonymous viewer at the photo door: only what the collage shows, identical null for everything else. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { photoHeaders, photoFactsFrom, servePhoto, type PhotoRecord } from "./photo-access";
import { TINY_PNG } from "./photo-fixtures";

function record(over: Partial<{ kind: string; hidden: boolean; published: boolean; consent: boolean; sessionPublished: boolean; superseded: boolean; purged: boolean }>): PhotoRecord {
  const o = { kind: "group", hidden: false, published: true, consent: false, sessionPublished: true, superseded: false, purged: false, ...over };
  const at = new Date("2026-12-05T12:00:00Z");
  return {
    facts: photoFactsFrom({
      kind: o.kind,
      sessionId: "s",
      stuffyId: o.kind === "group" ? null : "st",
      hiddenAt: o.hidden ? at : null,
      supersededAt: o.superseded ? at : null,
      purgedAt: o.purged ? at : null,
      publishedAt: o.published ? at : null,
      consent: o.consent,
      collagePublishedAt: o.sessionPublished ? at : null,
    }),
    storageKey: "k-full",
    thumbStorageKey: "k-thumb",
    contentType: "image/jpeg",
  };
}

const fakeStore = () =>
  ({ get: async () => ({ stream: new Blob([TINY_PNG as BlobPart]).stream(), contentType: "image/jpeg", size: TINY_PNG.length }) }) as never;

describe("public viewer at the photo door", () => {
  const pub = { kind: "public" } as const;

  it("exposes the exact same set the collage lists, and nothing else", async () => {
    const cases: [string, PhotoRecord, boolean][] = [
      ["published group", record({}), true],
      ["consented published portrait", record({ kind: "portrait", consent: true, published: true }), true],
      ["consented portrait not yet published (late)", record({ kind: "portrait", consent: true, published: false }), false],
      ["non-consented portrait", record({ kind: "portrait", consent: false, published: false }), false],
      ["hidden group", record({ hidden: true }), false],
      ["hidden consented portrait", record({ kind: "portrait", consent: true, hidden: true }), false],
      ["unpublished group", record({ published: false }), false],
      ["unpublished session", record({ sessionPublished: false }), false],
      ["superseded portrait", record({ kind: "portrait", consent: true, superseded: true }), false],
      ["purged group", record({ purged: true }), false],
      ["check-in photo", record({ kind: "check_in", consent: true }), false],
    ];
    for (const [label, rec, allowed] of cases) {
      const served = await servePhoto(pub, "p", "thumb", { load: async () => rec, store: fakeStore });
      expect(served !== null, label).toBe(allowed);
    }
  });

  it("every refusal is the same null (unknown id included): no distinguishable reason", async () => {
    const refusals = await Promise.all([
      servePhoto(pub, "p", "full", { load: async () => null }),
      servePhoto(pub, "p", "full", { load: async () => record({ hidden: true }) }),
      servePhoto(pub, "p", "full", { load: async () => record({ sessionPublished: false }) }),
      servePhoto(pub, "p", "full", { load: async () => record({ kind: "check_in" }) }),
    ]);
    expect(refusals).toEqual([null, null, null, null]);
  });

  it("a hidden photo is refused on the very next fetch (no server-side cache to outlive the flag)", async () => {
    let rec = record({});
    const deps = { load: async () => rec, store: fakeStore };
    expect(await servePhoto(pub, "p", "full", deps)).not.toBeNull();
    rec = record({ hidden: true });
    expect(await servePhoto(pub, "p", "full", deps)).toBeNull();
  });

  it("a portrait retaken after publish is a stranger 404 until Publish late photos stamps it, then 200", async () => {
    // Retake: the new row is current, consented, session live, but carries no publish stamp.
    let rec = record({ kind: "portrait", consent: true, published: false });
    const deps = { load: async () => rec, store: fakeStore };
    expect(await servePhoto(pub, "p", "thumb", deps)).toBeNull();
    // The admin (and the family, who own it) still see it meanwhile.
    expect(await servePhoto({ kind: "admin" }, "p", "thumb", deps)).not.toBeNull();
    // Publish late photos stamps it.
    rec = record({ kind: "portrait", consent: true, published: true });
    expect(await servePhoto(pub, "p", "thumb", deps)).not.toBeNull();
  });

  it("serves with the accepted 5-minute private cache and no indexing", () => {
    const h = photoHeaders(pub, { stream: new Blob([]).stream(), contentType: "image/jpeg", size: 3 });
    expect(h["Cache-Control"]).toBe("private, max-age=300");
    expect(h["X-Robots-Tag"]).toBe("noindex");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });
});
