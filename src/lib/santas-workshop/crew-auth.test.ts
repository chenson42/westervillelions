import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: async () => false }));

import type { SwSession } from "@/lib/db/schema";
import { evaluateCrewAccess, requireCrew, type CrewAuthDeps } from "./crew-auth";
import { crewCookieName, newDeviceId, signCrewCookie } from "./crew-cookie";
import { deriveKey } from "./crew-secret";
import { UUID_A, UUID_B } from "./photo-fixtures";

const key = deriveKey("auth-secret", "cookie");
const NOW = new Date("2026-12-18T15:00:00Z");

const session = (over: Partial<SwSession> = {}): SwSession =>
  ({ id: UUID_A, slug: "practice-a", status: "active", crewPaused: false, crewCodeVersion: 1, crewClosesOn: "2026-12-22", ...over }) as SwSession;

function deps(s: SwSession | null, admin: string | null = null): CrewAuthDeps {
  return {
    loadSession: async () => s,
    adminUserId: async () => admin,
    now: () => NOW,
    cookieKey: () => key,
    production: () => false,
  };
}

const cookieFor = (sessionId: string, over: Partial<{ v: number; e: number; d: string; s: string }> = {}) => {
  const value = signCrewCookie({ s: over.s ?? sessionId, v: over.v ?? 1, d: over.d ?? newDeviceId(), e: over.e ?? Math.floor(NOW.getTime() / 1000) + 3600 }, key);
  return `${crewCookieName(sessionId, false)}=${value}`;
};
const req = (cookie?: string) => new Request("http://localhost/x", { headers: cookie ? { cookie } : {} });

async function body(r: { ok: false; response: Response }) {
  return { status: r.response.status, text: await r.response.text() };
}

describe("requireCrew", () => {
  it("a valid cookie returns a crew credential with the device and code version", async () => {
    const r = await requireCrew(req(cookieFor(UUID_A)), { slug: "practice-a" }, deps(session()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.credential).toMatchObject({ kind: "crew", sessionId: UUID_A, codeVersion: 1 });
  });

  it("no cookie plus an admin with the key returns an admin credential", async () => {
    const r = await requireCrew(req(), { slug: "practice-a" }, deps(session(), "user-1"));
    expect(r.ok && r.credential).toMatchObject({ kind: "admin", deviceId: "admin", userId: "user-1" });
  });

  it("no cookie plus a member without the key is denied", async () => {
    const r = await requireCrew(req(), { slug: "practice-a" }, deps(session(), null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("a cookie for session A against session B's slug is denied", async () => {
    const b = session({ id: UUID_B, slug: "practice-b" });
    const r = await requireCrew(req(cookieFor(UUID_A)), { slug: "practice-b" }, deps(b));
    expect(r.ok).toBe(false);
  });

  it("a forged cookie naming another session id under this session's cookie name is denied", async () => {
    const forged = `${crewCookieName(UUID_A, false)}=${signCrewCookie({ s: UUID_B, v: 1, d: newDeviceId(), e: 2_000_000_000 }, key)}`;
    const r = await requireCrew(req(forged), { slug: "practice-a" }, deps(session()));
    expect(r.ok).toBe(false);
  });

  it("paused, closed (status), draft and past crew_closes_on are denied for crew", async () => {
    for (const s of [session({ crewPaused: true }), session({ status: "closed" }), session({ status: "draft" }), session({ crewClosesOn: "2026-12-17" })]) {
      const r = await requireCrew(req(cookieFor(UUID_A)), { slug: "x" }, deps(s));
      expect(r.ok, JSON.stringify(s)).toBe(false);
    }
  });

  it("the closing day itself is inclusive (Eastern string compare)", async () => {
    expect(evaluateCrewAccess(session({ crewClosesOn: "2026-12-18" }), { s: UUID_A, v: 1, d: "x".repeat(22), e: 2_000_000_000 }, NOW).ok).toBe(true);
    expect(evaluateCrewAccess(session({ crewClosesOn: "2026-12-17" }), { s: UUID_A, v: 1, d: "x".repeat(22), e: 2_000_000_000 }, NOW).ok).toBe(false);
    // 11:30 PM Eastern on the 18th is already the 19th in UTC: still the 18th here.
    expect(evaluateCrewAccess(session({ crewClosesOn: "2026-12-18" }), { s: UUID_A, v: 1, d: "x".repeat(22), e: 2_000_000_000 }, new Date("2026-12-19T04:30:00Z")).ok).toBe(true);
  });

  it("rotation signs the old cookie out on its next request; expiry does too", async () => {
    const rotated = await requireCrew(req(cookieFor(UUID_A, { v: 1 })), { slug: "x" }, deps(session({ crewCodeVersion: 2 })));
    expect(rotated.ok).toBe(false);
    const expired = await requireCrew(req(cookieFor(UUID_A, { e: Math.floor(NOW.getTime() / 1000) - 1 })), { slug: "x" }, deps(session()));
    expect(expired.ok).toBe(false);
  });

  it("admin bypass works while paused, closed and draft", async () => {
    for (const s of [session({ crewPaused: true }), session({ status: "closed" }), session({ status: "draft" })]) {
      const r = await requireCrew(req(), { slug: "x" }, deps(s, "user-1"));
      expect(r.ok).toBe(true);
    }
  });

  it("a reason appears only when the cookie signature was valid; every other denial is byte-identical", async () => {
    const paused = session({ crewPaused: true });
    const withSig = await requireCrew(req(cookieFor(UUID_A)), { slug: "x" }, deps(paused));
    const noCookie = await requireCrew(req(), { slug: "x" }, deps(paused));
    const garbage = await requireCrew(req(`${crewCookieName(UUID_A, false)}=garbage.value`), { slug: "x" }, deps(paused));
    const unknownSlug = await requireCrew(req(), { slug: "nope" }, deps(null));
    const forged = await requireCrew(req(`${crewCookieName(UUID_A, false)}=${signCrewCookie({ s: UUID_A, v: 1, d: newDeviceId(), e: 2_000_000_000 }, deriveKey("attacker", "cookie"))}`), { slug: "x" }, deps(paused));
    if (withSig.ok || noCookie.ok || garbage.ok || unknownSlug.ok || forged.ok) throw new Error("expected denials");
    expect((await body(withSig)).text).toContain('"reason":"paused"');
    const plain = (await body(noCookie)).text;
    expect(plain).not.toContain("reason");
    expect((await body(garbage)).text).toBe(plain);
    expect((await body(unknownSlug)).text).toBe(plain);
    expect((await body(forged)).text).toBe(plain);
  });

  it("an admin on an unknown slug gets a 404, not a credential", async () => {
    const r = await requireCrew(req(), { slug: "nope" }, deps(null, "user-1"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(404);
  });
});
