import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { decidePhotoAccess, photoHeaders, servePhoto, type PhotoFacts, type PhotoRecord, type PhotoViewer } from "./photo-access";
import { createMemoryPhotoStore } from "./photo-store/memory";
import { StorageUnavailable } from "./photo-store/errors";
import { PHOTO_KINDS } from "./photo-limits";
import { UUID_A, UUID_B, UUID_C, UUID_D } from "./photo-fixtures";

const SESSION = UUID_A;
const OTHER_SESSION = UUID_B;
const STUFFY = UUID_C;
const OTHER_STUFFY = UUID_D;

const facts = (over: Partial<PhotoFacts> = {}): PhotoFacts => ({
  kind: "portrait",
  sessionId: SESSION,
  stuffyId: STUFFY,
  hidden: false,
  superseded: false,
  purged: false,
  published: false,
  consent: false,
  sessionPublished: false,
  ...over,
});

/** The table of Phase 3, written as independent allow-clauses (not by calling the implementation). */
function expected(viewer: PhotoViewer, p: PhotoFacts, variant: "full" | "thumb"): boolean {
  if (p.purged) return false;
  if (viewer.kind === "admin") return true;
  if (viewer.kind === "crew") {
    if (viewer.sessionId !== p.sessionId || p.hidden) return false;
    if (p.kind === "check_in") return variant === "full" && !p.superseded;
    if (p.kind === "portrait") return !p.superseded;
    return p.kind === "group";
  }
  if (viewer.kind === "family") {
    return p.kind === "portrait" && p.stuffyId === viewer.stuffyId && !p.superseded && !p.hidden && p.sessionPublished;
  }
  if (p.hidden || p.superseded || !p.sessionPublished) return false;
  if (p.kind === "group") return p.published;
  return p.kind === "portrait" && p.consent && p.published;
}

describe("photo access matrix (viewer x kind x variant x published x hidden x consent x superseded x purged x session)", () => {
  const viewers: PhotoViewer[] = [
    { kind: "admin" },
    { kind: "crew", sessionId: SESSION },
    { kind: "crew", sessionId: OTHER_SESSION },
    { kind: "family", stuffyId: STUFFY },
    { kind: "family", stuffyId: OTHER_STUFFY },
    { kind: "public" },
  ];
  let combos = 0;
  for (const viewer of viewers) {
    for (const kind of PHOTO_KINDS) {
      for (const variant of ["full", "thumb"] as const) {
        for (const published of [false, true]) {
          for (const hidden of [false, true]) {
            for (const consent of [false, true]) {
              for (const superseded of [false, true]) {
                for (const purged of [false, true]) {
                  for (const sessionPublished of [false, true]) {
                    const photo = facts({ kind, published, hidden, consent, superseded, purged, sessionPublished, stuffyId: kind === "group" ? null : STUFFY });
                    combos += 1;
                    const want = expected(viewer, photo, variant);
                    if (decidePhotoAccess(viewer, photo, variant) !== want) {
                      it(`MISMATCH ${JSON.stringify({ viewer, kind, variant, published, hidden, consent, superseded, purged, sessionPublished })}`, () => {
                        expect(decidePhotoAccess(viewer, photo, variant)).toBe(want);
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  it("agrees with the written table on every combination", () => {
    expect(combos).toBe(viewers.length * 3 * 2 * 2 * 2 * 2 * 2 * 2 * 2);
  });

  it("spot checks that matter most", () => {
    // A hidden portrait is withheld from EVERY non-admin surface.
    const hidden = facts({ hidden: true, consent: true, published: true, sessionPublished: true });
    expect(decidePhotoAccess({ kind: "crew", sessionId: SESSION }, hidden, "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "family", stuffyId: STUFFY }, hidden, "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "public" }, hidden, "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "admin" }, hidden, "full")).toBe(true);
    // Family sees a non-consented portrait; public does not.
    const noConsent = facts({ consent: false, sessionPublished: true });
    expect(decidePhotoAccess({ kind: "family", stuffyId: STUFFY }, noConsent, "full")).toBe(true);
    expect(decidePhotoAccess({ kind: "public" }, noConsent, "full")).toBe(false);
    // A portrait taken after the last publish (consented, session live, no publish stamp) is private to strangers.
    const late = facts({ consent: true, published: false, sessionPublished: true });
    expect(decidePhotoAccess({ kind: "public" }, late, "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "public" }, { ...late, published: true }, "full")).toBe(true);
    expect(decidePhotoAccess({ kind: "family", stuffyId: STUFFY }, late, "full")).toBe(true); // the family's own photo
    // A check-in photo is never reachable anonymously, and crew never get its thumbnail.
    const checkIn = facts({ kind: "check_in", consent: true, sessionPublished: true, published: true });
    expect(decidePhotoAccess({ kind: "public" }, checkIn, "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "family", stuffyId: STUFFY }, checkIn, "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "crew", sessionId: SESSION }, checkIn, "thumb")).toBe(false);
    expect(decidePhotoAccess({ kind: "crew", sessionId: SESSION }, checkIn, "full")).toBe(true);
    // A crew cookie of another session is nothing; so is a family token against another stuffy's photo.
    expect(decidePhotoAccess({ kind: "crew", sessionId: OTHER_SESSION }, facts(), "full")).toBe(false);
    expect(decidePhotoAccess({ kind: "family", stuffyId: OTHER_STUFFY }, noConsent, "full")).toBe(false);
  });
});

describe("servePhoto", () => {
  async function setup(over: Partial<PhotoFacts> = {}, variants: { full?: boolean; thumb?: boolean } = { full: true, thumb: true }) {
    const store = createMemoryPhotoStore();
    const folder = await store.ensureFolder("s");
    const full = variants.full ? (await store.put({ folderKey: folder, photoId: UUID_A, variant: "full", bytes: Uint8Array.of(1, 2, 3), contentType: "image/jpeg" })).key : null;
    const thumb = variants.thumb ? (await store.put({ folderKey: folder, photoId: UUID_A, variant: "thumb", bytes: Uint8Array.of(9), contentType: "image/jpeg" })).key : null;
    const record: PhotoRecord = { facts: facts(over), storageKey: full, thumbStorageKey: thumb, contentType: "image/jpeg" };
    return { store, record };
  }
  const deps = (store: ReturnType<typeof createMemoryPhotoStore>, record: PhotoRecord | null) => ({ store: () => store, load: async () => record });

  it("streams bytes on an allow", async () => {
    const { store, record } = await setup();
    const served = await servePhoto({ kind: "crew", sessionId: SESSION }, UUID_A, "full", deps(store, record));
    expect(served).not.toBeNull();
    expect(served?.contentType).toBe("image/jpeg");
  });

  it("serves the thumb key for the thumb variant", async () => {
    const { store, record } = await setup();
    const served = await servePhoto({ kind: "admin" }, UUID_A, "thumb", deps(store, record));
    expect(served?.size).toBe(1);
  });

  it("every failure is the same null: unknown id, denied, missing key, missing bytes, storage outage", async () => {
    const { store, record } = await setup();
    expect(await servePhoto({ kind: "admin" }, UUID_A, "full", deps(store, null))).toBeNull();
    expect(await servePhoto({ kind: "crew", sessionId: OTHER_SESSION }, UUID_A, "full", deps(store, record))).toBeNull();
    expect(await servePhoto({ kind: "public" }, UUID_A, "full", deps(store, record))).toBeNull();
    const noKey = await setup({}, { full: false, thumb: false });
    expect(await servePhoto({ kind: "admin" }, UUID_A, "full", deps(noKey.store, noKey.record))).toBeNull();
    await store.delete(record.storageKey as string);
    expect(await servePhoto({ kind: "admin" }, UUID_A, "full", deps(store, record))).toBeNull();
    const down = await setup();
    down.store.setFailing(true);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await servePhoto({ kind: "admin" }, UUID_A, "full", deps(down.store, down.record))).toBeNull();
    spy.mockRestore();
  });

  it("a purged photo is null even for an admin", async () => {
    const { store, record } = await setup({ purged: true });
    expect(await servePhoto({ kind: "admin" }, UUID_A, "full", deps(store, record))).toBeNull();
  });

  it("an outage never leaks its message to the log (name and code only)", async () => {
    const down = await setup();
    down.store.setFailing(true);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await servePhoto({ kind: "admin" }, UUID_A, "full", deps(down.store, down.record));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Photo storage is not answering");
    expect(new StorageUnavailable().message).toContain("Photo storage");
    spy.mockRestore();
  });
});

describe("photoHeaders", () => {
  const served = { stream: new ReadableStream<Uint8Array>(), contentType: "image/jpeg", size: 5 };
  it("crew and admin are no-store; family and public are browser-private only; all are noindex and nosniff", () => {
    for (const viewer of [{ kind: "admin" }, { kind: "crew", sessionId: SESSION }] as PhotoViewer[]) {
      expect(photoHeaders(viewer, served)["Cache-Control"]).toBe("no-store");
    }
    for (const viewer of [{ kind: "family", stuffyId: STUFFY }, { kind: "public" }] as PhotoViewer[]) {
      expect(photoHeaders(viewer, served)["Cache-Control"]).toBe("private, max-age=300");
    }
    const h = photoHeaders({ kind: "public" }, served);
    expect(h["X-Robots-Tag"]).toBe("noindex");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Length"]).toBe("5");
  });

  it("a download uses a neutral file name", () => {
    expect(photoHeaders({ kind: "family", stuffyId: STUFFY }, served, true)["Content-Disposition"]).toBe('attachment; filename="stuffy-portrait.jpg"');
  });
});
