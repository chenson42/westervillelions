import { describe, expect, it } from "vitest";
import { buildChecklist, unmappedRequiredFields, type ChecklistFacts } from "./session-checklist";

const NOW = new Date("2026-11-20T15:00:00Z"); // Nov 20, Eastern
const base: ChecklistFacts = {
  now: NOW,
  campaignConnected: true,
  ticketRateCount: 1,
  unmappedRequiredFields: [],
  webhookSecretSet: true,
  apiKeySet: true,
  orderCount: 5,
  lastCampaignEventAt: new Date("2026-11-20T10:00:00Z"),
  lastAnyEventAt: new Date("2026-11-20T10:00:00Z"),
  lastSyncAt: null,
  dropoffDate: "2026-12-18",
};
const item = (f: ChecklistFacts, key: string) => buildChecklist(f).find((i) => i.key === key)!;

describe("buildChecklist", () => {
  it("a fully set up session is done where it can be", () => {
    for (const key of ["campaign_connected", "ticket_rates", "fields_mapped", "zeffy_configured", "last_event"]) {
      expect(item(base, key).state, key).toBe("done");
    }
  });

  it("an unconnected session asks for the form, rates and mapping", () => {
    const f = { ...base, campaignConnected: false, ticketRateCount: 0, unmappedRequiredFields: ["stuffy_name", "snack"] };
    expect(item(f, "campaign_connected").state).toBe("todo");
    expect(item(f, "ticket_rates")).toMatchObject({ state: "todo", detail: expect.stringContaining("nothing will be registered") });
    expect(item(f, "fields_mapped").detail).toContain("Stuffy name");
    expect(item(f, "fields_mapped").detail).toContain("Snack choice");
  });

  it("names which Zeffy setting is missing (booleans only, never a value)", () => {
    expect(item({ ...base, webhookSecretSet: false }, "zeffy_configured").detail).toBe("Missing: webhook secret.");
    expect(item({ ...base, apiKeySet: false }, "zeffy_configured").detail).toBe("Missing: API key.");
    expect(item({ ...base, webhookSecretSet: false, apiKeySet: false }, "zeffy_configured").detail).toBe("Missing: webhook secret and API key.");
  });

  it("last event is amber when registrants exist and nothing arrived in 24 hours", () => {
    const quiet = { ...base, lastCampaignEventAt: new Date("2026-11-18T10:00:00Z") };
    expect(item(quiet, "last_event").state).toBe("warn");
    expect(item(quiet, "last_event").detail).toContain("Sync");
  });

  it("last event is not amber when there are no registrants yet, and todo before any event", () => {
    expect(item({ ...base, orderCount: 0, lastCampaignEventAt: new Date("2026-11-01T00:00:00Z") }, "last_event").state).toBe("done");
    expect(item({ ...base, orderCount: 0, lastCampaignEventAt: null }, "last_event")).toMatchObject({ state: "todo", detail: expect.stringContaining("test purchase") });
  });

  it("registrants with no logged event at all is amber", () => {
    expect(item({ ...base, lastCampaignEventAt: null, orderCount: 3 }, "last_event").state).toBe("warn");
  });

  it("the quiet-form warning stops once drop-off day arrives", () => {
    const f = { ...base, now: new Date("2026-12-18T14:00:00Z"), lastCampaignEventAt: new Date("2026-12-10T00:00:00Z") };
    expect(item(f, "last_event").state).toBe("done");
  });

  it("the Friday Sync item: info before the day, todo on it, done once synced on or after it", () => {
    expect(item(base, "friday_sync").state).toBe("info");
    const onDay = { ...base, now: new Date("2026-12-18T13:00:00Z") };
    expect(item(onDay, "friday_sync").state).toBe("todo");
    expect(item({ ...onDay, lastSyncAt: new Date("2026-12-18T12:00:00Z") }, "friday_sync").state).toBe("done");
    expect(item({ ...onDay, lastSyncAt: new Date("2026-12-10T12:00:00Z") }, "friday_sync").state).toBe("todo");
  });

  it("storage and worker code are informational until the worker screens ship", () => {
    expect(item(base, "storage_tested").state).toBe("info");
    expect(item(base, "worker_code").state).toBe("info");
  });
});

describe("unmappedRequiredFields", () => {
  it("lists required fields with no mapped string", () => {
    expect(unmappedRequiredFields({})).toEqual(["stuffy_name", "snack", "dropoff_window"]);
    expect(unmappedRequiredFields({ stuffy_name: ["a"], snack: ["b"], dropoff_window: ["c"] })).toEqual([]);
    expect(unmappedRequiredFields({ stuffy_name: [], snack: ["b"] })).toEqual(["stuffy_name", "dropoff_window"]);
  });
});
