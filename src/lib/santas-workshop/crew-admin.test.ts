import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { st } = vi.hoisted(() => ({
  st: {
    row: null as Row | null,
    selectRows: [[], []] as Row[][],
    distinct: [[], []] as Row[][],
    updateReturn: null as Row[] | null,
    updates: [] as Row[],
    logs: [] as { kind: string; detail: Row }[],
    lastTest: null as { at: Date; ok: boolean; latencyMs: number | null } | null,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => st.selectRows.shift() ?? [] }) }) }),
    selectDistinct: () => ({ from: () => ({ where: async () => st.distinct.shift() ?? [] }) }),
    update: () => ({
      set: (set: Row) => ({
        where: () => ({
          returning: async () => {
            st.updates.push(set);
            return st.updateReturn ?? [{ ...(st.row as Row), ...set }];
          },
        }),
      }),
    }),
  },
}));
vi.mock("./session-log", () => ({
  logSessionEvent: async (_s: string, _u: string, kind: string, detail: Row) => {
    st.logs.push({ kind, detail });
  },
}));
vi.mock("./session-queries", async () => {
  const failure = (status: number, code: string, error: string, field?: string, extra: Row = {}) => ({ ok: false, status, code, error, ...(field ? { field } : {}), ...extra });
  return { failure, getSessionRow: async () => st.row, toSessionDto: (r: Row) => ({ id: r.id, status: r.status }) };
});
vi.mock("./storage-status", () => ({ lastStorageTest: async () => st.lastTest }));

import { decryptCrewCode, encryptCrewCode } from "./crew-code";
import { crewCodeAction, setSessionStatus, viewCrewCode } from "./crew-admin";
import { purposeKey } from "./crew-secret";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-12-18T15:00:00Z");

const session = (over: Row = {}): Row => ({ id: ID, kind: "practice", status: "draft", crewCodeEnc: null, crewCodeVersion: 1, crewPaused: false, personalPurgedAt: null, ...over });

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "crew-admin-test-secret");
  st.row = session();
  st.selectRows = [[], []];
  st.distinct = [[], []];
  st.updateReturn = null;
  st.updates = [];
  st.logs = [];
  st.lastTest = null;
});

describe("setSessionStatus", () => {
  it("activating a practice session issues the worker code and logs the change (no code in the log)", async () => {
    const r = await setSessionStatus(ID, "active", "u1", NOW);
    expect(r).toMatchObject({ ok: true, noop: false });
    const set = st.updates[0] as { status: string; crewCodeEnc: string };
    expect(set.status).toBe("active");
    expect(decryptCrewCode(set.crewCodeEnc, purposeKey("code"))).toMatch(/^[A-Z2-9]{8}$/);
    expect(st.logs).toEqual([{ kind: "status_changed", detail: { from: "draft", to: "active" } }]);
    expect(JSON.stringify(st.logs)).not.toContain(set.crewCodeEnc);
  });

  it("activating keeps an existing code (reopening a closed session does not change the number on everyone's phone)", async () => {
    st.row = session({ status: "closed", crewCodeEnc: "v1.keep.this.code" });
    await setSessionStatus(ID, "active", "u1", NOW);
    expect(st.updates[0]).not.toHaveProperty("crewCodeEnc");
  });

  it("a REAL session needs a passing storage test in the last 10 minutes (409 storage_not_ready)", async () => {
    st.row = session({ kind: "real" });
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, status: 409, code: "storage_not_ready" });
    st.lastTest = { at: new Date(NOW.getTime() - 11 * 60 * 1000), ok: true, latencyMs: 5 };
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, code: "storage_not_ready" });
    st.lastTest = { at: new Date(NOW.getTime() - 60 * 1000), ok: false, latencyMs: null };
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, code: "storage_not_ready" });
    expect(st.updates).toHaveLength(0);
    st.lastTest = { at: new Date(NOW.getTime() - 60 * 1000), ok: true, latencyMs: 5 };
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: true });
  });

  it("a practice session does not need the storage test", async () => {
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: true });
  });

  it("going back to draft is refused once anything has been tagged or photographed", async () => {
    st.row = session({ status: "active" });
    st.selectRows = [[{ id: "s1" }], []];
    expect(await setSessionStatus(ID, "draft", "u1", NOW)).toMatchObject({ ok: false, code: "has_activity" });
    st.selectRows = [[], [{ id: "p1" }]];
    expect(await setSessionStatus(ID, "draft", "u1", NOW)).toMatchObject({ ok: false, code: "has_activity" });
    st.selectRows = [[], []];
    expect(await setSessionStatus(ID, "draft", "u1", NOW)).toMatchObject({ ok: true });
  });

  it("a disallowed move, a purged session and an unknown session are refused", async () => {
    st.row = session({ status: "closed" });
    expect(await setSessionStatus(ID, "draft", "u1", NOW)).toMatchObject({ ok: false, code: "invalid_transition" });
    st.row = session({ status: "purged" });
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, code: "session_purged" });
    st.row = session({ personalPurgedAt: NOW });
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, code: "session_purged" });
    st.row = null;
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, status: 404 });
  });

  it("the same status is a no-op that writes nothing", async () => {
    st.row = session({ status: "active" });
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: true, noop: true });
    expect(st.updates).toHaveLength(0);
    expect(st.logs).toHaveLength(0);
  });

  it("a status that changed under the admin (the pinned UPDATE matches no row) is a 409", async () => {
    st.updateReturn = [];
    expect(await setSessionStatus(ID, "active", "u1", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(st.logs).toHaveLength(0);
  });
});

describe("worker code", () => {
  const key = () => purposeKey("code");

  it("viewing returns the code and the version, and logs code_viewed WITHOUT the code", async () => {
    st.row = session({ crewCodeEnc: encryptCrewCode("ABCDEF23", key()) });
    const r = await viewCrewCode(ID, "u1", NOW);
    expect(r).toMatchObject({ code: "ABCDEF23", formatted: "ABCD-EF23", unreadable: false, version: 1, paused: false });
    expect(st.logs).toEqual([{ kind: "code_viewed", detail: { version: 1 } }]);
  });

  it("a code sealed under a different AUTH_SECRET reads as unreadable (regenerate), never a crash", async () => {
    st.row = session({ crewCodeEnc: encryptCrewCode("ABCDEF23", Buffer.alloc(32, 7)) });
    expect(await viewCrewCode(ID, "u1", NOW)).toMatchObject({ code: null, unreadable: true });
  });

  it("no code issued yet is code null, not unreadable", async () => {
    expect(await viewCrewCode(ID, "u1", NOW)).toMatchObject({ code: null, unreadable: false });
  });

  it("rotate bumps the version, seals a new code and logs versions only", async () => {
    st.row = session({ status: "active", crewCodeEnc: encryptCrewCode("ABCDEF23", key()) });
    const r = await crewCodeAction(ID, "rotate", false, "u1", NOW);
    expect(r.ok).toBe(true);
    const set = st.updates[0] as { crewCodeEnc: string; crewCodeVersion: number };
    expect(set.crewCodeVersion).toBe(2);
    expect(decryptCrewCode(set.crewCodeEnc, key())).not.toBe("ABCDEF23");
    expect(st.logs[0]).toMatchObject({ kind: "code_rotated", detail: { fromVersion: 1, toVersion: 2, devices: 0 } });
    expect(JSON.stringify(st.logs)).not.toMatch(/[A-Z2-9]{8}/);
  });

  it("with devices active in the last hour the first rotate is 409 devices_active { count }; acknowledged, it goes through", async () => {
    st.row = session({ status: "active", crewCodeEnc: encryptCrewCode("ABCDEF23", key()) });
    st.distinct = [[{ deviceId: "a".repeat(22) }], [{ deviceId: "b".repeat(22) }, { deviceId: "a".repeat(22) }]];
    const first = await crewCodeAction(ID, "rotate", false, "u1", NOW);
    expect(first).toMatchObject({ ok: false, status: 409, code: "devices_active", count: 2 });
    expect(st.updates).toHaveLength(0);

    st.distinct = [[{ deviceId: "a".repeat(22) }], []];
    const second = await crewCodeAction(ID, "rotate", true, "u1", NOW);
    expect(second.ok).toBe(true);
    expect(st.logs.at(-1)).toMatchObject({ kind: "code_rotated", detail: { devices: 1 } });
  });

  it("rotating a session with no code issues the first one", async () => {
    const r = await crewCodeAction(ID, "rotate", false, "u1", NOW);
    expect(r.ok).toBe(true);
    expect((st.updates[0] as { crewCodeVersion: number }).crewCodeVersion).toBe(2);
  });

  it("pause and resume toggle crew_paused without touching the code or version", async () => {
    st.row = session({ status: "active", crewCodeEnc: "v1.a.b.c" });
    await crewCodeAction(ID, "pause", false, "u1", NOW);
    expect(st.updates[0]).toMatchObject({ crewPaused: true });
    expect(st.updates[0]).not.toHaveProperty("crewCodeVersion");
    await crewCodeAction(ID, "resume", false, "u1", NOW);
    expect(st.updates[1]).toMatchObject({ crewPaused: false });
    expect(st.logs.map((l) => l.kind)).toEqual(["code_paused", "code_resumed"]);
  });

  it("a write racing another admin (the pinned UPDATE matches no row) is a 409, not a silent overwrite", async () => {
    st.updateReturn = [];
    expect(await crewCodeAction(ID, "rotate", false, "u1", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(await crewCodeAction(ID, "pause", false, "u1", NOW)).toMatchObject({ ok: false, status: 409 });
  });

  it("a purged session's worker access cannot be changed", async () => {
    st.row = session({ status: "purged" });
    expect(await crewCodeAction(ID, "rotate", true, "u1", NOW)).toMatchObject({ ok: false, code: "session_purged" });
  });
});
