import { describe, expect, it, vi } from "vitest";
import { computeZeffySignature, verifyZeffySignature, SIGNATURE_TOLERANCE_SECONDS } from "./signature";
import { signZeffyBody } from "./test-helpers";

const SECRET = "whsec_devexample";
const NOW_S = 1_760_000_000;
const NOW_MS = NOW_S * 1000;
const enc = (s: string) => new TextEncoder().encode(s);
const BODY = '{"id":"evt-1","type":"payment.completed"}';

function verify(header: string | null, body: string | Uint8Array = BODY, nowMs = NOW_MS) {
  return verifyZeffySignature({
    secret: SECRET,
    header,
    rawBody: typeof body === "string" ? enc(body) : body,
    nowMs,
  });
}

describe("verifyZeffySignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verify(signZeffyBody(SECRET, BODY, NOW_S))).toEqual({ ok: true, timestamp: NOW_S });
  });

  it("rejects a body altered by one byte", () => {
    const header = signZeffyBody(SECRET, BODY, NOW_S);
    expect(verify(header, BODY.replace("evt-1", "evt-2"))).toEqual({ ok: false, reason: "no_match" });
  });

  it("rejects the wrong secret", () => {
    expect(verify(signZeffyBody("whsec_other", BODY, NOW_S)).ok).toBe(false);
  });

  it("rejects a missing header and a header with no v1", () => {
    expect(verify(null)).toEqual({ ok: false, reason: "missing_header" });
    expect(verify("")).toEqual({ ok: false, reason: "missing_header" });
    expect(verify(`t=${NOW_S}`)).toEqual({ ok: false, reason: "malformed_header" });
    expect(verify("garbage")).toEqual({ ok: false, reason: "malformed_header" });
  });

  it("rejects non-hex and wrong-length v1 without throwing", () => {
    expect(() => verify(`t=${NOW_S},v1=zzzz`)).not.toThrow();
    expect(verify(`t=${NOW_S},v1=zzzz`).ok).toBe(false);
    expect(verify(`t=${NOW_S},v1=abc`).ok).toBe(false); // odd length
    expect(verify(`t=${NOW_S},v1=abcd`).ok).toBe(false); // short
    expect(verify(`t=${NOW_S},v1=${"a".repeat(200)}`).ok).toBe(false); // long
  });

  it("rejects a timestamp 301 s old and 301 s in the future", () => {
    expect(verify(signZeffyBody(SECRET, BODY, NOW_S - 301))).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(verify(signZeffyBody(SECRET, BODY, NOW_S + 301))).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("accepts 299 s old and exactly the tolerance", () => {
    expect(verify(signZeffyBody(SECRET, BODY, NOW_S - 299)).ok).toBe(true);
    expect(verify(signZeffyBody(SECRET, BODY, NOW_S - SIGNATURE_TOLERANCE_SECONDS)).ok).toBe(true);
  });

  it("accepts when any one of repeated v1 values is valid", () => {
    const good = computeZeffySignature(SECRET, NOW_S, enc(BODY));
    expect(verify(`t=${NOW_S},v1=${"0".repeat(64)},v1=${good}`).ok).toBe(true);
    expect(verify(`t=${NOW_S},v1=${good},v1=${"0".repeat(64)}`).ok).toBe(true);
  });

  it("rejects a non-integer or malformed t", () => {
    for (const t of ["abc", "12.5", "-5", "1e9", ""]) {
      expect(verify(`t=${t},v1=${"a".repeat(64)}`).ok).toBe(false);
    }
    expect(verify(`t=abc,v1=${"a".repeat(64)}`)).toEqual({ ok: false, reason: "bad_timestamp" });
  });

  it("signs raw bytes, so a re-serialized JSON body fails", () => {
    const pretty = '{ "id": "evt-1",  "type": "payment.completed" }';
    const header = signZeffyBody(SECRET, pretty, NOW_S);
    expect(verify(header, pretty).ok).toBe(true);
    expect(verify(header, JSON.stringify(JSON.parse(pretty))).ok).toBe(false);
  });

  it("verifies non-UTF-8-safe raw bytes exactly", () => {
    const bytes = new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]);
    expect(verify(signZeffyBody(SECRET, bytes, NOW_S), bytes).ok).toBe(true);
  });

  it("calls timingSafeEqual only after the length check", () => {
    const spy = vi.fn((a: Uint8Array, b: Uint8Array) => a.length === b.length);
    const deps = { timingSafeEqual: spy };
    const input = { secret: SECRET, rawBody: enc(BODY), nowMs: NOW_MS };
    // wrong length: never reaches the comparison
    verifyZeffySignature({ ...input, header: `t=${NOW_S},v1=abcd` }, deps);
    verifyZeffySignature({ ...input, header: `t=${NOW_S},v1=zz` }, deps);
    expect(spy).not.toHaveBeenCalled();
    // right length: exactly one comparison per candidate
    verifyZeffySignature({ ...input, header: signZeffyBody(SECRET, BODY, NOW_S) }, deps);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].length).toBe(spy.mock.calls[0][1].length);
  });

  it("a replay inside tolerance still verifies (dedupe is the handler's job)", () => {
    const header = signZeffyBody(SECRET, BODY, NOW_S);
    expect(verify(header, BODY, NOW_MS).ok).toBe(true);
    expect(verify(header, BODY, NOW_MS + 60_000).ok).toBe(true);
  });
});
