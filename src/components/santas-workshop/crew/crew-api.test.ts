import { describe, expect, it, vi } from "vitest";
import { crewFetch, crewPaths, newKey, parseCrewErrorBody, photoUrl, postJson } from "./crew-api";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("crew api client", () => {
  it("builds session-scoped paths and encodes ids", () => {
    const p = crewPaths("practice-2026");
    expect(p.roster).toBe("/api/santas-workshop/crew/practice-2026/roster");
    expect(p.card("a b", "tag")).toBe("/api/santas-workshop/crew/practice-2026/stuffies/a%20b?view=tag");
    expect(p.search("pip & co")).toContain("q=pip%20%26%20co");
    expect(photoUrl("abc", "thumb")).toBe("/api/santas-workshop/photos/abc?v=thumb");
  });

  it("only trusts an error body whose code is in the contract", () => {
    expect(parseCrewErrorBody({ code: "stale_state", error: "x", currentState: "tagged", since: "t" })).toMatchObject({ code: "stale_state" });
    expect(parseCrewErrorBody({ code: "teapot", error: "x" })).toBeNull();
    expect(parseCrewErrorBody("nope")).toBeNull();
    expect(parseCrewErrorBody(null)).toBeNull();
  });

  it("returns data on success and the typed body on failure, and never throws", async () => {
    const ok = vi.fn().mockResolvedValue(json(200, { fine: true }));
    expect(await crewFetch("/x", {}, ok as unknown as typeof fetch)).toEqual({ ok: true, status: 200, data: { fine: true } });

    const bad = vi.fn().mockResolvedValue(json(409, { error: "x", code: "stale_state", currentState: "tagged", since: "t" }));
    const res = await crewFetch("/x", {}, bad as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: false, status: 409, body: { code: "stale_state" } });

    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await crewFetch("/x", {}, offline as unknown as typeof fetch)).toEqual({ ok: false, status: 0, body: null });

    const html = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await crewFetch("/x", {}, html as unknown as typeof fetch)).toEqual({ ok: false, status: 502, body: null });
  });

  it("posts JSON with the same-origin credentials and no caching", async () => {
    const f = vi.fn().mockResolvedValue(json(200, {}));
    await postJson("/x", { a: 1 }, f as unknown as typeof fetch);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBe('{"a":1}');
  });

  it("makes uuid-shaped keys that differ", () => {
    const a = newKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newKey()).not.toBe(a);
  });
});
