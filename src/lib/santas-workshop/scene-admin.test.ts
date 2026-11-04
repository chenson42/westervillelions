import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const { st } = vi.hoisted(() => ({
  st: {
    selects: [] as Row[][],
    updateResults: [] as Row[][],
    deleteResults: [] as Row[][],
    ops: [] as { op: string; table: string; values?: Row; set?: Row }[],
    logs: [] as { sessionId: string; kind: string; detail: Record<string, unknown> }[],
    list: [] as Row[],
    transactions: 0,
    throwOnUpdate: null as unknown,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const names = new Map<unknown, string>([
    [schema.swScenes, "scenes"],
    [schema.swPhotos, "photos"],
    [schema.swSessions, "sessions"],
  ]);
  const nameOf = (t: unknown) => names.get(t) ?? "other";
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
    insert: (t: unknown) => ({
      values: (values: Row) => {
        st.ops.push({ op: "insert", table: nameOf(t), values });
        return {
          returning: async () => [{ id: "new-scene", createdAt: new Date("2026-12-01T00:00:00Z"), updatedAt: new Date("2026-12-01T00:00:00Z"), ...values }],
        };
      },
    }),
    update: (t: unknown) => ({
      set: (set: Row) => {
        st.ops.push({ op: "update", table: nameOf(t), set });
        const thrown = st.throwOnUpdate;
        const run = async () => {
          if (thrown) throw thrown;
          return st.updateResults.shift() ?? [{ id: "row" }];
        };
        return { where: () => ({ returning: run, then: (r: (v: unknown) => unknown, j: (e: unknown) => unknown) => run().then(r, j) }) };
      },
    }),
    delete: (t: unknown) => {
      st.ops.push({ op: "delete", table: nameOf(t) });
      return { where: () => ({ returning: async () => st.deleteResults.shift() ?? [{ id: "row" }] }) };
    },
  };
  return {
    db: {
      select: () => selectChain(),
      ...writer,
      transaction: async (fn: (tx: unknown) => unknown) => {
        st.transactions += 1;
        return fn({ select: () => selectChain(), ...writer });
      },
    },
  };
});
vi.mock("./session-queries", () => ({
  failure: (status: number, code: string, error: string, field?: string) => ({ ok: false, status, code, error, ...(field ? { field } : {}) }),
}));
vi.mock("./session-log", () => ({
  logSessionEvent: async (sessionId: string, _u: string, kind: string, detail: Record<string, unknown>) => {
    st.logs.push({ sessionId, kind, detail });
  },
}));
vi.mock("./scene-queries", () => ({ listAdminScenes: async () => st.list }));

import { copySceneStoryline, copyScenes, createScene, deleteScene, reorderScenes, setPhotoScene, updateScene } from "./scene-admin";

const SID = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PHOTO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const sessionLocked = { id: SID, publicPurgedAt: null };

beforeEach(() => {
  st.selects = [];
  st.updateResults = [];
  st.deleteResults = [];
  st.ops = [];
  st.logs = [];
  st.list = [];
  st.transactions = 0;
  st.throwOnUpdate = null;
});

const writes = (table: string) => st.ops.filter((o) => o.table === table && o.op !== "select");

describe("createScene", () => {
  it("appends at max+1 under the session lock and audits ids and position only", async () => {
    st.selects = [[sessionLocked], [{ n: 3, max: 6 }]];
    const r = await createScene(SID, { title: "The Sleigh Arrives", caption: "Santa lands" }, "u1");
    expect(r).toMatchObject({ ok: true, response: { scene: { title: "The Sleigh Arrives", caption: "Santa lands", position: 7 } } });
    expect(writes("scenes")[0].values).toMatchObject({ sessionId: SID, position: 7 });
    expect(st.logs).toEqual([{ sessionId: SID, kind: "scene_created", detail: { sceneId: "new-scene", position: 7 } }]);
  });

  it("the first scene gets position 0", async () => {
    st.selects = [[sessionLocked], [{ n: 0, max: null }]];
    await createScene(SID, { title: "First" }, "u1");
    expect(writes("scenes")[0].values).toMatchObject({ position: 0 });
  });

  it("the 21st scene is refused with scene_limit and nothing is written", async () => {
    st.selects = [[sessionLocked], [{ n: 20, max: 19 }]];
    expect(await createScene(SID, { title: "One too many" }, "u1")).toMatchObject({ ok: false, status: 409, code: "scene_limit" });
    expect(writes("scenes")).toHaveLength(0);
    expect(st.logs).toEqual([]);
  });

  it("invalid text is a 400 naming the field, before any database use", async () => {
    expect(await createScene(SID, { title: "" }, "u1")).toMatchObject({ ok: false, status: 400, code: "invalid_input", field: "title" });
    expect(await createScene(SID, { title: "Ok", caption: "mail me a@b.co" }, "u1")).toMatchObject({ ok: false, status: 400, field: "caption" });
    expect(st.transactions).toBe(0);
  });

  it("a missing session is 404 and a publicly purged session is 409 session_purged: no write", async () => {
    st.selects = [[]];
    expect(await createScene(SID, { title: "T" }, "u1")).toMatchObject({ ok: false, status: 404, code: "not_found" });
    st.selects = [[{ id: SID, publicPurgedAt: new Date() }]];
    expect(await createScene(SID, { title: "T" }, "u1")).toMatchObject({ ok: false, status: 409, code: "session_purged" });
    expect(writes("scenes")).toHaveLength(0);
  });
});

describe("updateScene", () => {
  it("replaces title and caption, bumps updated_at, pinned to the scene AND the session, and audits the id only", async () => {
    const now = new Date("2026-12-02T10:00:00Z");
    st.selects = [[sessionLocked]];
    st.updateResults = [[{ id: A, title: "Santa Arrives", caption: null, position: 0, createdAt: now, updatedAt: now }]];
    st.list = [{ id: A, title: "Santa Arrives", caption: null, position: 0, photoCount: 4, unhiddenCount: 3, createdAt: "x", updatedAt: "y" }];
    const r = await updateScene(SID, A, { title: " Santa Arrives ", caption: "" }, "u1", now);
    expect(r).toMatchObject({ ok: true, response: { scene: { id: A, photoCount: 4 } } });
    expect(writes("scenes")[0].set).toEqual({ title: "Santa Arrives", caption: null, updatedAt: now });
    expect(st.logs).toEqual([{ sessionId: SID, kind: "scene_updated", detail: { sceneId: A } }]);
  });

  it("a scene that is not in this session (unknown, other session) is one 404", async () => {
    st.selects = [[sessionLocked]];
    st.updateResults = [[]];
    expect(await updateScene(SID, A, { title: "T" }, "u1")).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(st.logs).toEqual([]);
  });
});

describe("deleteScene", () => {
  it("returns movedPhotos, deletes only the scene (the FK sets scene_id null; no photo row is touched) and audits counts", async () => {
    st.selects = [[sessionLocked], [{ n: 5 }]];
    const r = await deleteScene(SID, A, "u1");
    expect(r).toEqual({ ok: true, response: { ok: true, movedPhotos: 5 } });
    expect(writes("photos")).toHaveLength(0);
    expect(writes("scenes").map((o) => o.op)).toEqual(["delete"]);
    expect(st.logs).toEqual([{ sessionId: SID, kind: "scene_deleted", detail: { sceneId: A, movedPhotos: 5 } }]);
  });

  it("an unknown scene is 404 with no audit row", async () => {
    st.selects = [[sessionLocked], [{ n: 0 }]];
    st.deleteResults = [[]];
    expect(await deleteScene(SID, A, "u1")).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(st.logs).toEqual([]);
  });

  it("a purged session blocks the delete", async () => {
    st.selects = [[{ id: SID, publicPurgedAt: new Date() }]];
    expect(await deleteScene(SID, A, "u1")).toMatchObject({ ok: false, code: "session_purged" });
    expect(writes("scenes")).toHaveLength(0);
  });
});

describe("copyScenes / copySceneStoryline (Slice B)", () => {
  const FROM = "99999999-9999-4999-8999-999999999999";
  const run = (from = FROM, to = SID) => copyScenes({ select: () => undefined } as never, { fromSessionId: from, toSessionId: to });

  it("copies title, caption and order as dense positions into an empty session; never touches photos", async () => {
    st.selects = [[sessionLocked], [{ n: 0 }], [{ title: "The Sleigh Arrives", caption: "Santa lands" }, { title: "Cookies", caption: null }]];
    const r = await copySceneStoryline(SID, FROM, "u1");
    expect(r).toMatchObject({ ok: true });
    expect(writes("scenes").map((o) => o.values)).toEqual([
      { sessionId: SID, title: "The Sleigh Arrives", caption: "Santa lands", position: 0 },
      { sessionId: SID, title: "Cookies", caption: null, position: 1 },
    ]);
    expect(writes("photos")).toHaveLength(0);
    expect(st.transactions).toBe(1);
    expect(st.logs).toEqual([{ sessionId: SID, kind: "scenes_copied", detail: { fromSessionId: FROM, count: 2 } }]);
    expect(JSON.stringify(st.logs)).not.toMatch(/Sleigh|Cookies|Santa lands/);
  });

  it("refuses a target that already has scenes (scenes_not_empty): nothing written, no audit", async () => {
    st.selects = [[sessionLocked], [{ n: 1 }]];
    expect(await copySceneStoryline(SID, FROM, "u1")).toMatchObject({ ok: false, status: 409, code: "scenes_not_empty" });
    expect(writes("scenes")).toHaveLength(0);
    expect(st.logs).toEqual([]);
  });

  it("a source with no scenes is 409 no_scenes_to_copy; a missing source is 404", async () => {
    st.selects = [[sessionLocked], [{ n: 0 }], [], [{ id: FROM }]];
    expect(await copySceneStoryline(SID, FROM, "u1")).toMatchObject({ ok: false, status: 409, code: "no_scenes_to_copy" });
    st.selects = [[sessionLocked], [{ n: 0 }], [], []];
    expect(await copySceneStoryline(SID, FROM, "u1")).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(writes("scenes")).toHaveLength(0);
  });

  it("the same session is 400 before any database use", async () => {
    expect(await run(SID, SID)).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
    expect(await copySceneStoryline(SID, SID, "u1")).toMatchObject({ ok: false, status: 400 });
    expect(st.transactions).toBe(1);
  });

  it("a publicly purged target is refused (session_purged); a purged SOURCE is not read as a reason to refuse", async () => {
    st.selects = [[{ id: SID, publicPurgedAt: new Date() }]];
    expect(await copySceneStoryline(SID, FROM, "u1")).toMatchObject({ ok: false, status: 409, code: "session_purged" });
    expect(writes("scenes")).toHaveLength(0);
  });

  it("a stored row that no longer validates unchanged fails the whole copy, naming its position (never partial)", async () => {
    st.selects = [[sessionLocked], [{ n: 0 }], [{ title: "Fine", caption: null }, { title: "Mail a@b.co", caption: null }]];
    const r = await copySceneStoryline(SID, FROM, "u1");
    expect(r).toMatchObject({ ok: false, status: 400, code: "invalid_input" });
    expect((r as { error: string }).error).toContain("Scene 2");
    expect(writes("scenes")).toHaveLength(0);
    expect(st.logs).toEqual([]);
  });
});

describe("reorderScenes", () => {
  it("rewrites dense positions 0..n-1 in the new order, in one transaction, and audits the count", async () => {
    st.selects = [[sessionLocked], [{ id: A }, { id: B }, { id: C }]];
    st.list = [{ id: C }, { id: A }, { id: B }];
    const r = await reorderScenes(SID, [C, A, B], "u1");
    expect(r).toMatchObject({ ok: true, response: { scenes: [{ id: C }, { id: A }, { id: B }] } });
    expect(writes("scenes").map((o) => o.set)).toEqual([{ position: 0 }, { position: 1 }, { position: 2 }]);
    expect(st.transactions).toBe(1);
    expect(st.logs).toEqual([{ sessionId: SID, kind: "scenes_reordered", detail: { count: 3 } }]);
  });

  it("the same order again rewrites nothing new in the log (idempotent double-click)", async () => {
    st.selects = [[sessionLocked], [{ id: A }, { id: B }]];
    await reorderScenes(SID, [A, B], "u1");
    expect(st.logs).toEqual([]);
  });

  it("a missing, extra or foreign id is 409 scenes_changed and writes nothing", async () => {
    for (const order of [[A], [A, B, C], [A, C]]) {
      st.ops = [];
      st.selects = [[sessionLocked], [{ id: A }, { id: B }]];
      expect(await reorderScenes(SID, order, "u1")).toMatchObject({ ok: false, status: 409, code: "scenes_changed" });
      expect(writes("scenes")).toHaveLength(0);
    }
  });
});

describe("setPhotoScene (reassign)", () => {
  const photo = (over: Row = {}) => ({ id: PHOTO, sessionId: SID, kind: "group", purgedAt: null, sceneId: null, ...over });

  it("moves a group photo with one pinned UPDATE that sets scene_id and nothing else, and audits from/to ids", async () => {
    st.selects = [[photo()], [{ id: A, title: "Arrival" }]];
    const r = await setPhotoScene(PHOTO, A, "u1");
    expect(r).toEqual({ ok: true, response: { ok: true, sceneId: A, sceneTitle: "Arrival" } });
    expect(writes("photos")).toEqual([{ op: "update", table: "photos", set: { sceneId: A } }]);
    expect(st.logs).toEqual([{ sessionId: SID, kind: "photo_scene_changed", detail: { photoId: PHOTO, fromSceneId: null, toSceneId: A } }]);
  });

  it("clearing the scene (null) is allowed", async () => {
    st.selects = [[photo({ sceneId: A })]];
    expect(await setPhotoScene(PHOTO, null, "u1")).toEqual({ ok: true, response: { ok: true, sceneId: null, sceneTitle: null } });
    expect(st.logs[0].detail).toEqual({ photoId: PHOTO, fromSceneId: A, toSceneId: null });
  });

  it("a scene that is not in the photo's session is 409 scene_gone and nothing is written", async () => {
    st.selects = [[photo()], []];
    expect(await setPhotoScene(PHOTO, B, "u1")).toMatchObject({ ok: false, status: 409, code: "scene_gone" });
    expect(writes("photos")).toHaveLength(0);
    expect(st.logs).toEqual([]);
  });

  it("a scene deleted between the lookup and the write (23503) is also scene_gone", async () => {
    st.selects = [[photo()], [{ id: A, title: "Arrival" }]];
    st.throwOnUpdate = Object.assign(new Error("fk"), { code: "23503" });
    expect(await setPhotoScene(PHOTO, A, "u1")).toMatchObject({ ok: false, status: 409, code: "scene_gone" });
    expect(st.logs).toEqual([]);
  });

  it("an unknown photo, a portrait or check-in photo, and a purged photo are one 404", async () => {
    for (const rows of [[], [photo({ kind: "portrait" })], [photo({ kind: "check_in" })], [photo({ purgedAt: new Date() })]]) {
      st.selects = [rows as Row[]];
      expect(await setPhotoScene(PHOTO, A, "u1")).toMatchObject({ ok: false, status: 404, code: "not_found" });
    }
    expect(writes("photos")).toHaveLength(0);
  });

  it("zero rows updated (the photo was purged meanwhile) rolls back as a 404, with no audit row", async () => {
    st.selects = [[photo()], [{ id: A, title: "Arrival" }]];
    st.updateResults = [[]];
    expect(await setPhotoScene(PHOTO, A, "u1")).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(st.logs).toEqual([]);
  });

  it("setting the same value again succeeds with no audit row", async () => {
    st.selects = [[photo({ sceneId: A })], [{ id: A, title: "Arrival" }]];
    expect(await setPhotoScene(PHOTO, A, "u1")).toMatchObject({ ok: true });
    expect(st.logs).toEqual([]);
  });
});

describe("scene-admin source scans", () => {
  const src = readFileSync(join(__dirname, "scene-admin.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the reassign update never touches published_at, created_at, hidden_at or any review column", () => {
    const fn = src.slice(src.indexOf("export async function setPhotoScene"));
    const update = fn.slice(fn.indexOf(".update(swPhotos)"), fn.indexOf(".returning", fn.indexOf(".update(swPhotos)")));
    expect(update).toMatch(/\.set\(\{ sceneId: target \}\)/);
    expect(update).not.toMatch(/publishedAt|createdAt|hiddenAt|hiddenByUserId|reviewed|supersededAt|takenAt/);
    expect(fn).toMatch(/eq\(swPhotos\.kind, "group"\), isNull\(swPhotos\.purgedAt\)/);
    expect(fn).toMatch(/throw new Rollback\(\)/); // a plain return from db.transaction would commit
  });

  it("every write that can change scene text is gated by validateSceneText, and audit rows never mention title or caption", () => {
    for (const fn of ["createScene", "updateScene"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      expect(body.indexOf("validateSceneText(")).toBeGreaterThan(-1);
      expect(body.indexOf("validateSceneText(")).toBeLessThan(body.indexOf("db.transaction("));
    }
    for (const m of src.matchAll(/logSessionEvent\(([\s\S]*?)\);/g)) expect(m[1]).not.toMatch(/title|caption/i);
    expect(src).not.toMatch(/console\./);
  });

  it("every transaction takes the session row lock first (FOR UPDATE)", () => {
    expect(src.match(/db\.transaction\(/g)?.length).toBe(6); // 5 writers + copySceneStoryline (locks inside copyScenes)
    expect(src.match(/lockSession\(tx, sessionId\)/g)?.length).toBe(4);
    expect(src.match(/lockSession\(tx, toSessionId\)/g)?.length).toBe(1);
    expect(src).toMatch(/\.for\("update"\)/);
  });
});

describe("swScenes is written only in scene-admin.ts and only after validateSceneText", () => {
  const SRC = join(__dirname, "..", "..");
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) acc.push(p);
    }
    return acc;
  };
  const WRITE = /\.(insert|update|delete)\(\s*swScenes\b/;

  it("no other production module writes sw_scenes", () => {
    const writers = walk(SRC).filter((f) => WRITE.test(readFileSync(f, "utf8")));
    expect(writers.map((f) => f.slice(SRC.length + 1))).toEqual(["lib/santas-workshop/scene-admin.ts"]);
  });

  it("sw_photos.scene_id is set only by scene-admin.ts (reassign: .set) and photo-service.ts (the upload INSERT: .values)", () => {
    const files = walk(SRC);
    const setters = files.filter((f) => /\.set\(\{[^}]*\bsceneId\b/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1));
    const inserters = files.filter((f) => /\.values\(\{[^}]*\bsceneId\b/.test(readFileSync(f, "utf8"))).map((f) => f.slice(SRC.length + 1));
    expect(setters).toEqual(["lib/santas-workshop/scene-admin.ts"]);
    expect(inserters).toEqual(["lib/santas-workshop/photo-service.ts"]);
  });

  it("no collage module imports scene-queries or scene-admin (counts cannot reach the public view)", () => {
    for (const f of walk(join(SRC, "lib", "santas-workshop")).filter((x) => /collage-/.test(x))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/scene-queries|scene-admin/);
    }
  });
});
