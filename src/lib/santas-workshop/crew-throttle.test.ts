import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: async () => false }));

import type { SwSession } from "@/lib/db/schema";
import { encryptCrewCode } from "./crew-code";
import { THROTTLED_MESSAGE, WRONG_CODE_MESSAGE, enterWithCode, type EnterDeps } from "./crew-entry";
import { crewCookieName, signCrewCookie, newDeviceId } from "./crew-cookie";
import { deriveKey } from "./crew-secret";
import { clientIp, ipScopeKey, isBlocked, recordFailure, sessionScopeKey, THROTTLE, type AttemptStore } from "./crew-throttle";
import { UUID_A, UUID_B } from "./photo-fixtures";

const SECRET = "throttle-secret";
const codeKey = deriveKey(SECRET, "code");
const cookieKey = deriveKey(SECRET, "cookie");
const ipKey = deriveKey(SECRET, "ip");
const NOW = new Date("2026-12-18T15:00:00Z");

function memoryStore() {
  const rows: { scopeKey: string; createdAt: Date }[] = [];
  const store: AttemptStore & { rows: typeof rows; sweeps: Date[]; counts: number } = {
    rows,
    sweeps: [],
    counts: 0,
    async count(scopeKey, since) {
      store.counts += 1;
      return rows.filter((r) => r.scopeKey === scopeKey && r.createdAt >= since).length;
    },
    async insert(scopeKeys, at) {
      for (const scopeKey of scopeKeys) rows.push({ scopeKey, createdAt: at });
    },
    async sweep(before) {
      store.sweeps.push(before);
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].createdAt < before) rows.splice(i, 1);
    },
  };
  return store;
}

const CODE = "ABCDEF23";
const baseSession = (over: Partial<SwSession> = {}): SwSession =>
  ({ id: UUID_A, slug: "practice-a", status: "active", crewPaused: false, crewCodeVersion: 1, crewClosesOn: "2026-12-22", crewCodeEnc: encryptCrewCode(CODE, codeKey), ...over }) as SwSession;

function depsFor(store: AttemptStore, session: SwSession | null, now = NOW): EnterDeps {
  return {
    loadSession: async () => session,
    attempts: store,
    now: () => now,
    codeKey: () => codeKey,
    cookieKey: () => cookieKey,
    ipKey: () => ipKey,
    production: () => false,
  };
}

const from = (ip: string, cookie?: string) => ({ headers: new Headers({ "x-forwarded-for": `${ip}, 10.0.0.1`, ...(cookie ? { cookie } : {}) }) });

describe("code entry throttle", () => {
  it("the 5th failure from one IP blocks the 6th, even with the right code", async () => {
    const store = memoryStore();
    const deps = depsFor(store, baseSession());
    for (let i = 0; i < 5; i += 1) {
      const r = await enterWithCode(from("203.0.113.9"), "practice-a", "WRONG123", deps);
      expect(r).toMatchObject({ ok: false, status: 401 });
    }
    const sixth = await enterWithCode(from("203.0.113.9"), "practice-a", CODE, deps);
    expect(sixth).toMatchObject({ ok: false, status: 429 });
  });

  it("another IP is unaffected", async () => {
    const store = memoryStore();
    const deps = depsFor(store, baseSession());
    for (let i = 0; i < 5; i += 1) await enterWithCode(from("203.0.113.9"), "practice-a", "WRONG123", deps);
    const other = await enterWithCode(from("198.51.100.4"), "practice-a", CODE, deps);
    expect(other.ok).toBe(true);
  });

  it("30 session-wide failures block every IP", async () => {
    const store = memoryStore();
    const deps = depsFor(store, baseSession());
    for (let i = 0; i < THROTTLE.sessionShort.limit; i += 1) {
      await recordFailure(store, { ip: ipScopeKey(`192.0.2.${i}`, ipKey), session: sessionScopeKey(UUID_A) }, NOW);
    }
    const r = await enterWithCode(from("198.51.100.77"), "practice-a", CODE, deps);
    expect(r).toMatchObject({ ok: false, status: 429 });
  });

  it("a success does not clear counts", async () => {
    const store = memoryStore();
    const deps = depsFor(store, baseSession());
    for (let i = 0; i < 4; i += 1) await enterWithCode(from("203.0.113.9"), "practice-a", "WRONG123", deps);
    expect((await enterWithCode(from("203.0.113.9"), "practice-a", CODE, deps)).ok).toBe(true);
    expect(store.rows.filter((r) => r.scopeKey.startsWith("ip:"))).toHaveLength(4);
    await enterWithCode(from("203.0.113.9"), "practice-a", "WRONG123", deps); // the 5th failure
    expect(await enterWithCode(from("203.0.113.9"), "practice-a", CODE, deps)).toMatchObject({ status: 429 });
  });

  it("the daily limit blocks after 20 failures spread over the day", async () => {
    const store = memoryStore();
    const ip = ipScopeKey("203.0.113.9", ipKey);
    for (let i = 0; i < THROTTLE.ipDay.limit; i += 1) {
      await store.insert([ip], new Date(NOW.getTime() - (i + 1) * 60 * 60 * 1000 + 59 * 60 * 1000));
    }
    expect(await isBlocked(store, { ip }, NOW)).toBe(true);
  });

  it("a request carrying a valid cookie never consults the throttle (requireCrew answers first; entry is a separate route)", async () => {
    // enter is the only importer of the throttle: crew-auth must not.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(readFileSync(join(__dirname, "crew-auth.ts"), "utf8")).not.toMatch(/crew-throttle/);
  });

  it("the stored scope key contains no raw IP", async () => {
    const store = memoryStore();
    await enterWithCode(from("203.0.113.9"), "practice-a", "WRONG123", depsFor(store, baseSession()));
    for (const row of store.rows) {
      expect(row.scopeKey).not.toContain("203.0.113.9");
      expect(row.scopeKey).toMatch(/^(ip:[0-9a-f]{16}|sess:[0-9a-f-]{36})$/);
    }
  });

  it("the sweep deletes rows older than 2 days when a failure is recorded", async () => {
    const store = memoryStore();
    store.rows.push({ scopeKey: "ip:old", createdAt: new Date(NOW.getTime() - 3 * 24 * 3600 * 1000) });
    store.rows.push({ scopeKey: "ip:recent", createdAt: new Date(NOW.getTime() - 3600 * 1000) });
    await recordFailure(store, { ip: "ip:x" }, NOW);
    expect(store.rows.map((r) => r.scopeKey).sort()).toEqual(["ip:recent", "ip:x"]);
    expect(THROTTLE.sweepAfterMs).toBe(2 * 24 * 3600 * 1000);
  });

  it("an unknown slug counts against the IP only", async () => {
    const store = memoryStore();
    const r = await enterWithCode(from("203.0.113.9"), "nope", "WRONG123", depsFor(store, null));
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].scopeKey.startsWith("ip:")).toBe(true);
  });

  it("wrong, revoked, paused, closed, draft and unknown-slug answers are byte-identical; only a block adds 'Wait a few minutes.'", async () => {
    const bodies: string[] = [];
    const cases: [string, SwSession | null, unknown][] = [
      ["wrong", baseSession(), "WRONG123"],
      ["revoked (rotated)", baseSession({ crewCodeEnc: encryptCrewCode("ZZZZ2222", codeKey) }), CODE],
      ["paused", baseSession({ crewPaused: true }), CODE],
      ["closed", baseSession({ status: "closed" }), CODE],
      ["draft", baseSession({ status: "draft" }), CODE],
      ["unknown slug", null, CODE],
      ["unreadable code", baseSession({ crewCodeEnc: "v1.x.y.z" }), CODE],
      ["not a string", baseSession(), 12345],
    ];
    for (const [, session, code] of cases) {
      const r = await enterWithCode(from("203.0.113.9"), "practice-a", code, depsFor(memoryStore(), session));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(401);
        bodies.push(JSON.stringify(r.body));
      }
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain(WRONG_CODE_MESSAGE);
    expect(bodies[0]).not.toContain("Wait a few minutes");
    expect(THROTTLED_MESSAGE).toBe(`${WRONG_CODE_MESSAGE} Wait a few minutes.`);
  });

  it("a success sets a Lax HttpOnly cookie for that session and keeps the device id on re-entry", async () => {
    const first = await enterWithCode(from("203.0.113.9"), "practice-a", "abcd-ef23", depsFor(memoryStore(), baseSession()));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.setCookie).toContain(crewCookieName(UUID_A, false));
    expect(first.setCookie).toContain("HttpOnly");
    expect(first.setCookie).toContain("SameSite=Lax");

    const device = newDeviceId();
    const existing = `${crewCookieName(UUID_A, false)}=${signCrewCookie({ s: UUID_A, v: 1, d: device, e: 2_000_000_000 }, cookieKey)}`;
    const again = await enterWithCode(from("203.0.113.9", existing), "practice-a", CODE, depsFor(memoryStore(), baseSession()));
    expect(again.ok).toBe(true);
    if (again.ok) {
      const value = again.setCookie.split(";")[0].split("=").slice(1).join("=");
      const payload = JSON.parse(Buffer.from(value.split(".")[0], "base64url").toString("utf8"));
      expect(payload.d).toBe(device);
    }
  });

  it("does not let a different session's slug accept this code", async () => {
    const other = baseSession({ id: UUID_B, slug: "practice-b", crewCodeEnc: encryptCrewCode("OTHER234", codeKey) });
    const r = await enterWithCode(from("203.0.113.9"), "practice-b", CODE, depsFor(memoryStore(), other));
    expect(r.ok).toBe(false);
  });

  it("clientIp takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.2" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
