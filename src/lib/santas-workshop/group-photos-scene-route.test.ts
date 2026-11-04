/**
 * The group-photos route answers identically whether the volunteer's scene id was valid, unknown,
 * deleted, foreign, malformed or absent: it parses a bare UUID and the scene is resolved inside the
 * INSERT (photo-service.ts). No enumeration signal (analyst ruling 15, T2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { st } = vi.hoisted(() => ({
  st: { meta: {} as Record<string, unknown>, commits: [] as { sceneId: string | null }[] },
}));

vi.mock("@/lib/santas-workshop/crew-auth", () => ({
  requireCrew: async () => ({
    ok: true,
    credential: { kind: "crew", deviceId: "d".repeat(22), codeVersion: 1 },
    session: { id: "11111111-1111-4111-8111-111111111111", kind: "practice" },
  }),
}));
vi.mock("@/lib/santas-workshop/crew-respond", () => ({
  writeContextFor: () => ({ sessionId: "11111111-1111-4111-8111-111111111111", sessionKind: "practice", actor: { kind: "crew", deviceId: "d", codeVersion: 1 } }),
  refusalResponse: () => new Response("refused", { status: 400 }),
}));
vi.mock("@/lib/santas-workshop/photo-upload", () => ({
  readUploadParts: async () => ({ ok: true, parts: { meta: st.meta, full: new Uint8Array(), thumb: new Uint8Array() } }),
}));
vi.mock("@/lib/santas-workshop/photo-service", () => ({
  parsePhotoMeta: (m: Record<string, unknown>) => ({ ok: true, value: { photoId: String(m.photoId) } }),
  isUploadRefusal: () => false,
  ingestPhoto: async (args: { commit: (p: unknown) => Promise<unknown> }) => args.commit({ id: "p" }),
  // The commit fake mimics the database: only a scene of THIS session resolves; everything else stores null.
  commitGroupPhoto: async (_ctx: unknown, _photo: unknown, sceneId: string | null) => {
    st.commits.push({ sceneId });
    return { ok: true, replayed: false };
  },
}));

import { POST } from "@/app/api/santas-workshop/crew/[slug]/group-photos/route";

const PHOTO = "22222222-2222-4222-8222-222222222222";
const SCENE = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

async function post(sceneId: unknown) {
  st.meta = { photoId: PHOTO, ...(sceneId === undefined ? {} : { sceneId }) };
  const res = await POST(new Request("http://x/api/santas-workshop/crew/practice/group-photos", { method: "POST" }), { params: Promise.resolve({ slug: "practice" }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  st.commits = [];
});

describe("group-photos route: no enumeration signal", () => {
  it("valid, unknown, deleted, foreign, malformed, empty, non-string and absent scene ids all get the same status and body", async () => {
    const cases: unknown[] = [SCENE, "44444444-4444-4444-8444-444444444444", SCENE.toUpperCase(), "not-a-uuid", "", 12, { id: SCENE }, [SCENE], null, undefined];
    const results = [];
    for (const c of cases) results.push(await post(c));
    const first = results[0];
    expect(first).toEqual({ status: 200, body: { ok: true, photoId: PHOTO, replayed: false } });
    for (const r of results) expect(r).toEqual(first);
  });

  it("passes the commit a lower-cased uuid for a well-formed id and null for everything else", async () => {
    for (const c of [SCENE.toUpperCase(), "not-a-uuid", 12, undefined]) await post(c);
    expect(st.commits.map((c) => c.sceneId)).toEqual([SCENE, null, null, null]);
  });

  it("GroupPhotoResponse has no scene field (the response never echoes it)", async () => {
    const { body } = await post(SCENE);
    expect(Object.keys(body).sort()).toEqual(["ok", "photoId", "replayed"]);
  });
});
