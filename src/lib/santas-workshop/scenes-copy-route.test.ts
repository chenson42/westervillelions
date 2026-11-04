import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: null as { id: string } | null, allowed: true, copy: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => (h.user ? { user: h.user } : null) }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: async () => h.allowed }));
vi.mock("@/lib/santas-workshop/scene-admin", () => ({ copySceneStoryline: h.copy }));

import { POST } from "../../app/api/admin/santas-workshop/sessions/[id]/scenes/copy/route";

const TO = "11111111-1111-4111-8111-111111111111";
const FROM = "99999999-9999-4999-8999-999999999999";
const call = (body: unknown, id = TO) =>
  POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.user = { id: "u1" };
  h.allowed = true;
  h.copy.mockReset();
});

describe("POST scenes/copy", () => {
  it("401 without a session and 403 without santas_workshop.manage; nothing is copied", async () => {
    h.user = null;
    expect((await call({ fromSessionId: FROM })).status).toBe(401);
    h.user = { id: "u1" };
    h.allowed = false;
    expect((await call({ fromSessionId: FROM })).status).toBe(403);
    expect(h.copy).not.toHaveBeenCalled();
  });

  it("400 for a missing or non-uuid fromSessionId, 404 for a malformed target id", async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ fromSessionId: "nope" })).status).toBe(400);
    expect((await call({ fromSessionId: FROM }, "bad")).status).toBe(404);
    expect(h.copy).not.toHaveBeenCalled();
  });

  it("passes target, source and the user through; returns the failure code and status", async () => {
    h.copy.mockResolvedValueOnce({ ok: true, response: { scenes: [] } });
    expect((await call({ fromSessionId: FROM.toUpperCase() })).status).toBe(200);
    expect(h.copy).toHaveBeenCalledWith(TO, FROM, "u1");
    h.copy.mockResolvedValueOnce({ ok: false, status: 409, code: "scenes_not_empty", error: "x" });
    const res = await call({ fromSessionId: FROM });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "scenes_not_empty" });
  });
});
