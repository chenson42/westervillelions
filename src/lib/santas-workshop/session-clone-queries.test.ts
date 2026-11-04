import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sourceRows: [] as unknown[],
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  txCalls: 0,
  insertError: null as unknown,
  selectedShape: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => {
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (state.insertError && "slug" in values) throw state.insertError;
        state.inserts.push({ table, values });
        return {
          returning: async () => [
            {
              id: "22222222-2222-4222-8222-222222222222",
              status: "draft",
              createdAt: new Date("2026-11-04T12:00:00Z"),
              updatedAt: new Date("2026-11-04T12:00:00Z"),
              questionMap: {},
              crewCodeEnc: null,
              crewCodeVersion: 1,
              zeffyCampaignTitle: null,
              zeffyTicketRateIds: [],
              personalPurgedAt: null,
              publicPurgedAt: null,
              ...values,
            },
          ],
          then: undefined,
        };
      },
    }),
  };
  const db = {
    select: (shape: Record<string, unknown>) => {
      state.selectedShape = shape;
      return { from: () => ({ where: () => ({ limit: async () => state.sourceRows }) }) };
    },
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
      state.txCalls += 1;
      return cb(tx);
    },
  };
  return { db };
});
vi.mock("@/lib/zeffy/events-queries", () => ({ lastCampaignEventReceivedAt: async () => null, lastEventReceivedAt: async () => null }));

import { swSessionLog, swSessions } from "@/lib/db/schema";
import { createSession } from "./session-queries";

const SRC = "11111111-1111-4111-8111-111111111111";
const sourceRow = {
  id: SRC,
  slug: "practice-2026",
  name: "Source",
  kind: "practice",
  dropoffDate: "2026-12-18",
  photoDate: "2026-12-19",
  pickupDate: "2026-12-20",
  windows: [{ id: "w1", label: "4 to 5", start: "16:00", end: "17:00" }],
  crewClosesOn: "2026-12-23",
  purgePersonalOn: "2027-01-22",
  purgePublicOn: "2027-02-02",
  storageQuotaBytes: 250 * 1024 * 1024,
  frameArtKey: "santa",
  framePartSize: 80,
  questionMap: { snack: ["favorite snack"] },
};
const input = (over = {}) => ({
  name: "N",
  slug: "workshop-2026",
  kind: "real" as const,
  dropoffDate: "2026-12-18",
  photoDate: "2026-12-19",
  pickupDate: "2026-12-20",
  windows: sourceRow.windows,
  ...over,
});

beforeEach(() => {
  state.sourceRows = [sourceRow];
  state.inserts = [];
  state.txCalls = 0;
  state.insertError = null;
  state.selectedShape = null;
});

describe("createSession clone", () => {
  it("clone inserts one session and one created log row with detail { kind, clonedFrom } in the same transaction", async () => {
    const r = await createSession(input({ cloneFrom: SRC }), "u1");
    expect(r.ok).toBe(true);
    expect(state.txCalls).toBe(1);
    expect(state.inserts.map((i) => i.table)).toEqual([swSessions, swSessionLog]);
    expect(state.inserts[0].values).toMatchObject({
      frameFilePrefix: "",
      frameArtKey: "santa",
      framePartSize: 80,
      questionMap: { snack: ["favorite snack"] },
      storageQuotaBytes: 600 * 1024 * 1024,
      crewClosesOn: "2026-12-23",
    });
    expect(state.inserts[1].values).toMatchObject({ kind: "created", detail: { kind: "real", clonedFrom: SRC } });
  });

  it("clone mints a collage token different from the source's", async () => {
    await createSession(input({ cloneFrom: SRC }), "u1");
    const values = state.inserts[0].values;
    expect(typeof values.collageToken).toBe("string");
    expect(values).not.toHaveProperty("crewCodeEnc");
    expect(values).not.toHaveProperty("zeffyCampaignId");
    expect(values).not.toHaveProperty("status");
    // The source's token column is never selected at all.
    expect(Object.keys(state.selectedShape ?? {})).not.toEqual(expect.arrayContaining(["collageToken"]));
    expect(Object.keys(state.selectedShape ?? {})).not.toEqual(expect.arrayContaining(["crewCodeEnc"]));
  });

  it("clone of a missing source returns 404 not_found and inserts nothing", async () => {
    state.sourceRows = [];
    const r = await createSession(input({ cloneFrom: SRC }), "u1");
    expect(r).toMatchObject({ ok: false, status: 404, code: "not_found", field: "cloneFrom" });
    expect(state.inserts).toEqual([]);
    expect(state.txCalls).toBe(0);
  });

  it("clone of a source whose settings no longer validate returns 400 and inserts nothing", async () => {
    state.sourceRows = [{ ...sourceRow, questionMap: { bogus: ["x"] } }];
    const r = await createSession(input({ cloneFrom: SRC }), "u1");
    expect(r).toMatchObject({ ok: false, status: 400, code: "invalid_input", field: "cloneFrom" });
    expect(state.inserts).toEqual([]);
  });

  it("clone slug collision returns 409 slug_taken", async () => {
    state.insertError = { code: "23505", constraint_name: "ux_sw_sessions_slug" };
    const r = await createSession(input({ cloneFrom: SRC }), "u1");
    expect(r).toMatchObject({ ok: false, status: 409, code: "slug_taken", field: "slug" });
  });

  it("the plain create path still logs { kind } only and reads no source", async () => {
    const r = await createSession(input(), "u1");
    expect(r.ok).toBe(true);
    expect(state.selectedShape).toBeNull();
    expect(state.inserts[1].values).toMatchObject({ kind: "created", detail: { kind: "real" } });
    expect(state.inserts[0].values).toMatchObject({ storageQuotaBytes: 600 * 1024 * 1024, crewClosesOn: "2026-12-21" });
    expect(state.inserts[0].values).not.toHaveProperty("questionMap");
  });
});
