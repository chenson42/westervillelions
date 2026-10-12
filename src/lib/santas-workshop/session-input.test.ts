import { describe, expect, it } from "vitest";
import { WORKSHOP_2026 } from "./facts";
import {
  addDays,
  defaultCrewClosesOn,
  defaultRetention,
  defaultSessionDraft,
  isRealDay,
  validateConnectCampaign,
  validateCreateSession,
  validateQuestionMap,
  validateSessionDates,
  validateUpdateSession,
  validateWindows,
} from "./session-input";

const WINDOWS = [{ id: "fri-1600", label: "4:00 PM – 5:00 PM", start: "16:00", end: "17:00" }];
const valid = () => ({
  name: "Dry run",
  slug: "dry-run-2026",
  kind: "practice",
  dropoffDate: "2026-12-18",
  photoDate: "2026-12-19",
  pickupDate: "2026-12-20",
  windows: WINDOWS,
});

describe("validateCreateSession", () => {
  it("accepts a valid session", () => {
    const r = validateCreateSession(valid());
    expect(r).toEqual({ ok: true, value: valid() });
  });

  it("trims the name and rejects empty or oversize names", () => {
    expect(validateCreateSession({ ...valid(), name: "  Padded  " })).toMatchObject({ ok: true, value: { name: "Padded" } });
    expect(validateCreateSession({ ...valid(), name: "   " })).toMatchObject({ ok: false, field: "name" });
    expect(validateCreateSession({ ...valid(), name: "x".repeat(121) })).toMatchObject({ ok: false, field: "name" });
  });

  it.each(["ab", "UPPER", "has space", "under_score", "x".repeat(41), "", 5])("rejects slug %j", (slug) => {
    expect(validateCreateSession({ ...valid(), slug })).toMatchObject({ ok: false, field: "slug" });
  });

  it("requires kind to be practice or real", () => {
    expect(validateCreateSession({ ...valid(), kind: "real" }).ok).toBe(true);
    expect(validateCreateSession({ ...valid(), kind: "rehearsal" })).toMatchObject({ ok: false, field: "kind" });
    expect(validateCreateSession({ ...valid(), kind: undefined })).toMatchObject({ ok: false, field: "kind" });
  });

  it("rejects impossible and mis-ordered dates", () => {
    expect(validateCreateSession({ ...valid(), dropoffDate: "2026-02-30" })).toMatchObject({ ok: false, field: "dropoffDate" });
    expect(validateCreateSession({ ...valid(), photoDate: "12/19/2026" })).toMatchObject({ ok: false, field: "photoDate" });
    expect(validateCreateSession({ ...valid(), photoDate: "2026-12-17" })).toMatchObject({ ok: false, field: "photoDate" });
    expect(validateCreateSession({ ...valid(), pickupDate: "2026-12-18" })).toMatchObject({ ok: false, field: "pickupDate" });
  });

  it("rejects a non-object body", () => {
    for (const body of [null, "x", 5, [], undefined]) expect(validateCreateSession(body).ok).toBe(false);
  });
});

describe("validateUpdateSession (PATCH)", () => {
  it("rejects kind and slug with immutable_field", () => {
    expect(validateUpdateSession({ kind: "real" })).toMatchObject({ ok: false, code: "immutable_field", field: "kind" });
    expect(validateUpdateSession({ slug: "new-slug" })).toMatchObject({ ok: false, code: "immutable_field", field: "slug" });
    expect(validateUpdateSession({ name: "ok", kind: "practice" })).toMatchObject({ ok: false, code: "immutable_field" });
    // even a no-op value is rejected: the field must not be sent at all
    expect(validateUpdateSession({ kind: undefined })).toMatchObject({ ok: false, code: "immutable_field" });
  });

  it("rejects unknown fields and an empty body", () => {
    expect(validateUpdateSession({ status: "closed" })).toMatchObject({ ok: false, field: "status", code: "invalid_input" });
    expect(validateUpdateSession({ zeffyCampaignId: "x" })).toMatchObject({ ok: false });
    expect(validateUpdateSession({})).toMatchObject({ ok: false });
  });

  it("accepts every patchable field", () => {
    const patch = {
      name: "Renamed",
      dropoffDate: "2026-12-18",
      photoDate: "2026-12-19",
      pickupDate: "2026-12-20",
      windows: WINDOWS,
      crewClosesOn: "2026-12-21",
      purgePersonalOn: "2027-01-19",
      purgePublicOn: "2027-01-31",
      storageQuotaBytes: 100 * 1024 * 1024,
      frameArtKey: "plain",
      frameFilePrefix: "",
      framePartSize: 100,
    };
    expect(validateUpdateSession(patch)).toEqual({ ok: true, value: patch });
  });

  it("bounds quota, part size, art key and prefix", () => {
    expect(validateUpdateSession({ storageQuotaBytes: 10 })).toMatchObject({ ok: false, field: "storageQuotaBytes" });
    expect(validateUpdateSession({ storageQuotaBytes: 1.5e9 + 0.5 })).toMatchObject({ ok: false });
    expect(validateUpdateSession({ framePartSize: 5 })).toMatchObject({ ok: false, field: "framePartSize" });
    expect(validateUpdateSession({ framePartSize: 501 })).toMatchObject({ ok: false });
    expect(validateUpdateSession({ frameArtKey: "../etc" })).toMatchObject({ ok: false, field: "frameArtKey" });
    expect(validateUpdateSession({ frameFilePrefix: "Bad Prefix" })).toMatchObject({ ok: false, field: "frameFilePrefix" });
  });
});

describe("windows", () => {
  it("accepts and trims labels", () => {
    expect(validateWindows([{ ...WINDOWS[0], label: "  4 to 5  " }])).toMatchObject({ ok: true, value: [{ label: "4 to 5" }] });
  });
  it.each([
    [[]],
    ["nope"],
    [[{ ...WINDOWS[0], id: "Bad Id" }]],
    [[{ ...WINDOWS[0], start: "25:00" }]],
    [[{ ...WINDOWS[0], start: "17:00", end: "16:00" }]],
    [[{ ...WINDOWS[0], label: "" }]],
    [[WINDOWS[0], WINDOWS[0]]],
    [Array.from({ length: 13 }, (_, i) => ({ ...WINDOWS[0], id: `w-${i}` }))],
  ])("rejects %j", (windows) => {
    expect(validateWindows(windows).ok).toBe(false);
  });
});

describe("dates and defaults", () => {
  it("isRealDay", () => {
    expect(isRealDay("2026-12-18")).toBe(true);
    expect(isRealDay("2026-02-29")).toBe(false);
    expect(isRealDay("2028-02-29")).toBe(true);
    expect(isRealDay(20261218)).toBe(false);
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-12-20", 1)).toBe("2026-12-21");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("default retention is pickup + 30 days and Jan 31 of the following year", () => {
    expect(defaultRetention("2026-12-20")).toEqual({ purgePersonalOn: "2027-01-19", purgePublicOn: "2027-01-31" });
    expect(defaultCrewClosesOn("2026-12-20")).toBe("2026-12-21");
  });

  it("validateSessionDates enforces ordering on the merged values", () => {
    const ok = { dropoffDate: "2026-12-18", photoDate: "2026-12-19", pickupDate: "2026-12-20", crewClosesOn: "2026-12-21", purgePersonalOn: "2027-01-19", purgePublicOn: "2027-01-31" };
    expect(validateSessionDates(ok).ok).toBe(true);
    expect(validateSessionDates({ ...ok, crewClosesOn: "2026-12-19" })).toMatchObject({ ok: false, field: "crewClosesOn" });
    expect(validateSessionDates({ ...ok, purgePersonalOn: "2026-12-20" })).toMatchObject({ ok: false, field: "purgePersonalOn" });
    expect(validateSessionDates({ ...ok, purgePublicOn: "2027-01-01" })).toMatchObject({ ok: false, field: "purgePublicOn" });
  });

  it("the new-session draft is pre-filled from WORKSHOP_2026 and itself validates once a slug is chosen", () => {
    const draft = defaultSessionDraft("real");
    expect(draft.dropoffDate).toBe(WORKSHOP_2026.dates.dropoff);
    expect(draft.pickupDate).toBe(WORKSHOP_2026.dates.pickup);
    expect(draft.windows.map((w) => w.id)).toEqual(WORKSHOP_2026.windows.map((w) => w.id));
    expect(draft.windows[0].label).toMatch(/PM/);
    expect(validateCreateSession({ ...draft, slug: "santas-workshop-2026" }).ok).toBe(true);
    expect(defaultSessionDraft("practice").kind).toBe("practice");
  });
});

describe("validateConnectCampaign", () => {
  it("accepts and de-duplicates rate ids", () => {
    expect(validateConnectCampaign({ campaignId: "camp-1", ticketRateIds: ["r1", "r1", "r2"] })).toEqual({
      ok: true,
      value: { campaignId: "camp-1", ticketRateIds: ["r1", "r2"], campaignTitle: null },
    });
  });
  it("rejects a missing or malformed campaign id and bad rates", () => {
    expect(validateConnectCampaign({ ticketRateIds: [] })).toMatchObject({ ok: false, field: "campaignId" });
    expect(validateConnectCampaign({ campaignId: "has space", ticketRateIds: [] })).toMatchObject({ ok: false, field: "campaignId" });
    expect(validateConnectCampaign({ campaignId: "c", ticketRateIds: "r1" })).toMatchObject({ ok: false, field: "ticketRateIds" });
    expect(validateConnectCampaign({ campaignId: "c", ticketRateIds: [5] })).toMatchObject({ ok: false });
    expect(validateConnectCampaign({ campaignId: "c", ticketRateIds: [], campaignTitle: "x".repeat(201) })).toMatchObject({ ok: false });
  });
});

describe("validateQuestionMap", () => {
  it("normalizes strings and drops empty fields", () => {
    expect(validateQuestionMap({ map: { stuffy_name: ["Stuffy's Name *", "  name of stuffy "], snack: [] } })).toEqual({
      ok: true,
      value: { stuffy_name: ["stuffy's name", "name of stuffy"] },
    });
  });
  it("lets several strings map to one field but never one string to two", () => {
    expect(validateQuestionMap({ map: { stuffy_name: ["name"], snack: ["Name?"] } })).toMatchObject({ ok: false, code: "duplicate_mapping" });
    expect(validateQuestionMap({ map: { stuffy_name: ["name", "NAME"] } })).toEqual({ ok: true, value: { stuffy_name: ["name"] } });
  });
  it("accepts the ignored key and rejects unknown fields and bad shapes", () => {
    expect(validateQuestionMap({ map: { ignored: ["anything else"] } }).ok).toBe(true);
    expect(validateQuestionMap({ map: { password: ["x"] } })).toMatchObject({ ok: false, field: "password" });
    expect(validateQuestionMap({ map: { snack: "snack" } })).toMatchObject({ ok: false });
    expect(validateQuestionMap({ map: { snack: [5] } })).toMatchObject({ ok: false });
    expect(validateQuestionMap({ map: { snack: Array.from({ length: 21 }, (_, i) => `q${i}`) } })).toMatchObject({ ok: false });
    expect(validateQuestionMap({ nope: 1 })).toMatchObject({ ok: false });
    expect(validateQuestionMap(null).ok).toBe(false);
  });
});
