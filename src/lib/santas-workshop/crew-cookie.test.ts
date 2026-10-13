import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CREW_COOKIE_MAX_AGE_SECONDS, crewCookieHeader, crewCookieName, newDeviceId, readCookie, signCrewCookie, verifyCrewCookie, type CrewCookiePayload } from "./crew-cookie";
import { deriveKey } from "./crew-secret";
import { UUID_A, UUID_B } from "./photo-fixtures";

const key = deriveKey("cookie-secret", "cookie");
const payload = (over: Partial<CrewCookiePayload> = {}): CrewCookiePayload => ({ s: UUID_A, v: 1, d: newDeviceId(), e: 2_000_000_000, ...over });

describe("crew cookie", () => {
  it("sign/verify round trip", () => {
    const p = payload();
    const v = verifyCrewCookie(signCrewCookie(p, key), key);
    expect(v).toEqual({ ok: true, payload: p });
  });

  it("a tampered payload is rejected", () => {
    const [body, sig] = signCrewCookie(payload(), key).split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload({ s: UUID_B }) })).toString("base64url");
    expect(verifyCrewCookie(`${forged}.${sig}`, key)).toEqual({ ok: false, reason: "bad_signature" });
    expect(body).toBeTruthy();
  });

  it("a tampered signature is rejected", () => {
    const [body, sig] = signCrewCookie(payload(), key).split(".");
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifyCrewCookie(`${body}.${flipped}`, key)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a cookie signed with another key is rejected (the derived key differs per purpose and secret)", () => {
    expect(verifyCrewCookie(signCrewCookie(payload(), deriveKey("other", "cookie")), key).ok).toBe(false);
    expect(deriveKey("same-secret", "cookie").equals(deriveKey("same-secret", "code"))).toBe(false);
    expect(deriveKey("same-secret", "cookie").equals(Buffer.from("same-secret"))).toBe(false);
  });

  it("malformed values are rejected without throwing", () => {
    for (const v of [undefined, null, "", "abc", "a.b.c", ".", "x."]) expect(verifyCrewCookie(v, key).ok).toBe(false);
  });

  it("a validly signed but badly shaped payload is malformed", () => {
    const body = Buffer.from(JSON.stringify({ s: UUID_A, v: "1", d: "short", e: 1 })).toString("base64url");
    // Sign it properly so only the shape check can reject it.
    const signed = signCrewCookie({ s: UUID_A, v: 1, d: "short", e: 1 } as CrewCookiePayload, key);
    expect(verifyCrewCookie(signed, key)).toEqual({ ok: false, reason: "malformed" });
    expect(body).toBeTruthy();
  });

  it("the cookie name is per session", () => {
    expect(crewCookieName(UUID_A, false)).not.toBe(crewCookieName(UUID_B, false));
    expect(crewCookieName(UUID_A, false)).toBe("swcrew-11111111");
  });

  it("Secure and the __Host- prefix appear only in production", () => {
    expect(crewCookieName(UUID_A, true).startsWith("__Host-")).toBe(true);
    expect(crewCookieName(UUID_A, false).startsWith("__Host-")).toBe(false);
    expect(crewCookieHeader("n", "v", true)).toContain("Secure");
    expect(crewCookieHeader("n", "v", false)).not.toContain("Secure");
  });

  it("HttpOnly, SameSite=Lax, Path=/ and a 72 hour absolute lifetime", () => {
    const header = crewCookieHeader("n", "v", false);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${72 * 3600}`);
    expect(CREW_COOKIE_MAX_AGE_SECONDS).toBe(72 * 3600);
  });

  it("reads one cookie out of a Cookie header", () => {
    expect(readCookie("a=1; swcrew-x=abc.def; b=2", "swcrew-x")).toBe("abc.def");
    expect(readCookie("a=1", "missing")).toBeUndefined();
    expect(readCookie(null, "x")).toBeUndefined();
  });

  it("the signature comparison is constant-time (timingSafeEqual after a length check)", () => {
    const source = readFileSync(join(__dirname, "crew-cookie.ts"), "utf8");
    expect(source).toContain("timingSafeEqual");
    expect(source.indexOf("given.length !== expected.length")).toBeLessThan(source.indexOf("timingSafeEqual(given"));
  });
});
