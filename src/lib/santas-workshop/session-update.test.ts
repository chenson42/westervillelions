import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwSession } from "@/lib/db/schema";

const state = vi.hoisted(() => ({ sessionRow: null as unknown, inUse: 0, updates: [] as unknown[] }));

vi.mock("@/lib/db", () => {
  const select = (fields?: unknown) => ({
    from: () => ({
      where: () => {
        // getSessionRow selects every column and uses .limit(1); the in-use count has a field map and is awaited directly.
        const rows = fields ? [{ n: state.inUse }] : [state.sessionRow];
        return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
      },
    }),
  });
  return {
    db: {
      select,
      update: () => ({
        set: (v: unknown) => {
          state.updates.push(v);
          return { where: () => ({ returning: () => Promise.resolve([{ ...(state.sessionRow as object), ...(v as object) }]) }) };
        },
      }),
    },
  };
});
vi.mock("@/lib/zeffy/events-queries", () => ({ lastCampaignEventReceivedAt: async () => null, lastEventReceivedAt: async () => null }));
vi.mock("./session-log", () => ({ logSessionEvent: async () => {} }));

import { updateSession } from "./session-queries";

const at = new Date("2026-11-09T12:00:00Z");
const row = {
  id: "s", slug: "slug", name: "N", kind: "practice", status: "draft", dropoffDate: "2026-12-18", photoDate: "2026-12-19", pickupDate: "2026-12-20",
  windows: [
    { id: "w1", label: "4 to 5", start: "16:00", end: "17:00" },
    { id: "w2", label: "5 to 6", start: "17:00", end: "18:00" },
  ],
  crewClosesOn: "2026-12-21", zeffyCampaignId: null, zeffyCampaignTitle: null, zeffyTicketRateIds: [], questionMap: {}, crewCodeEnc: null, crewCodeVersion: 1,
  collageToken: "T".repeat(22), storageQuotaBytes: 1000, frameArtKey: "plain", frameFilePrefix: "", framePartSize: 100, purgePersonalOn: "2027-01-19",
  purgePublicOn: "2027-01-31", personalPurgedAt: null, publicPurgedAt: null, createdAt: at, updatedAt: at,
} as unknown as SwSession;

beforeEach(() => {
  state.sessionRow = row;
  state.inUse = 0;
  state.updates = [];
});

describe("updateSession windows", () => {
  it("a label change on a window orders reference succeeds (same id, no in-use check needed)", async () => {
    state.inUse = 5;
    const windows = [{ ...row.windows[0], label: "Four to five" }, row.windows[1]];
    const out = await updateSession("s", { windows }, "u");
    expect(out.ok).toBe(true);
    expect(state.updates[0]).toMatchObject({ windows });
  });

  it("removing a window registrants chose is refused as window_in_use and writes nothing", async () => {
    state.inUse = 2;
    const out = await updateSession("s", { windows: [row.windows[0]] }, "u");
    expect(out).toMatchObject({ ok: false, status: 409, code: "window_in_use" });
    expect(state.updates).toHaveLength(0);
  });

  it("removing an unused window succeeds", async () => {
    const out = await updateSession("s", { windows: [row.windows[0]] }, "u");
    expect(out.ok).toBe(true);
  });
});
