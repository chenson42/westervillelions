import { describe, expect, it } from "vitest";
import type { CreateSessionRequest } from "./admin-contract";
import { cloneConfig, cloneDraft, cloneQuotaBytes, isPastDay, suggestCloneSlug, type CloneSource } from "./session-clone";
import { DEFAULT_QUOTA_BYTES, defaultCrewClosesOn, defaultRetention, validateCreateSession, validateSessionDates } from "./session-input";

const MB = 1024 * 1024;

const source = (over: Partial<CloneSource> = {}): CloneSource => ({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "practice-2026",
  name: "Source name",
  kind: "practice",
  dropoffDate: "2026-12-18",
  photoDate: "2026-12-19",
  pickupDate: "2026-12-20",
  windows: [{ id: "w1", label: "4 to 5", start: "16:00", end: "17:00" }],
  crewClosesOn: "2026-12-23",
  purgePersonalOn: "2027-01-22",
  purgePublicOn: "2027-02-02",
  storageQuotaBytes: 250 * MB,
  frameArtKey: "santa",
  framePartSize: 80,
  questionMap: { snack: ["Favorite Snack?"] },
  ...over,
});

const request = (over: Partial<CreateSessionRequest> = {}): CreateSessionRequest => ({
  name: "N",
  slug: "workshop-2026",
  kind: "practice",
  dropoffDate: "2026-12-18",
  photoDate: "2026-12-19",
  pickupDate: "2026-12-20",
  windows: [{ id: "w1", label: "4 to 5", start: "16:00", end: "17:00" }],
  ...over,
});

function config(src: CloneSource, req: CreateSessionRequest) {
  const r = cloneConfig(src, req);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("cloneConfig", () => {
  it("copies the quota for the same kind and uses the new kind's default across kinds", () => {
    expect(config(source(), request()).storageQuotaBytes).toBe(250 * MB);
    expect(config(source({ kind: "practice" }), request({ kind: "real" })).storageQuotaBytes).toBe(600 * MB);
    expect(config(source({ kind: "real" }), request({ kind: "practice" })).storageQuotaBytes).toBe(100 * MB);
    expect(config(source({ storageQuotaBytes: 5 }), request()).storageQuotaBytes).toBe(DEFAULT_QUOTA_BYTES.practice);
    expect(cloneQuotaBytes("real", 700 * MB, "real")).toBe(700 * MB);
  });

  it("always resets the frame file prefix to empty", () => {
    for (const kind of ["practice", "real"] as const) {
      expect(config(source(), request({ kind })).frameFilePrefix).toBe("");
    }
  });

  it("copies crew-closes and purge dates only when the pickup date is unchanged", () => {
    const same = config(source(), request());
    expect([same.crewClosesOn, same.purgePersonalOn, same.purgePublicOn]).toEqual(["2026-12-23", "2027-01-22", "2027-02-02"]);

    const moved = config(source(), request({ dropoffDate: "2027-12-17", photoDate: "2027-12-18", pickupDate: "2027-12-19" }));
    expect(moved.crewClosesOn).toBe(defaultCrewClosesOn("2027-12-19"));
    expect({ purgePersonalOn: moved.purgePersonalOn, purgePublicOn: moved.purgePublicOn }).toEqual(defaultRetention("2027-12-19"));
  });

  it("never produces a date set validateSessionDates rejects", () => {
    const pickups = ["2024-02-29", "2026-12-20", "2026-12-31", "2027-01-01", "2030-06-15"];
    for (const pickup of pickups) {
      for (const src of [source(), source({ pickupDate: pickup, crewClosesOn: "2020-01-01" })]) {
        const req = request({ dropoffDate: pickup, photoDate: pickup, pickupDate: pickup });
        const c = config(src, req);
        expect(validateSessionDates({ dropoffDate: pickup, photoDate: pickup, pickupDate: pickup, ...c }).ok).toBe(true);
      }
    }
  });

  it("stores the validated, normalized question map and fails with a typed error when the source map is invalid", () => {
    expect(config(source({ questionMap: { snack: ["  Favorite   Snack? "] } }), request()).questionMap).toEqual({ snack: ["favorite snack"] });
    const bad = cloneConfig(source({ questionMap: { snack: ["Same?"], ignored: ["same"] } }), request());
    expect(bad).toEqual({ ok: false, error: "The source session's settings need fixing before it can be cloned" });
    expect(cloneConfig(source({ questionMap: { nonsense: ["x"] } }), request()).ok).toBe(false);
    expect(cloneConfig(source({ frameArtKey: "Bad Key" }), request()).ok).toBe(false);
  });

  it("result has exactly the allowlisted keys", () => {
    const keys = Object.keys(config(source(), request())).sort();
    expect(keys).toEqual(
      ["crewClosesOn", "frameArtKey", "frameFilePrefix", "framePartSize", "purgePersonalOn", "purgePublicOn", "questionMap", "storageQuotaBytes"].sort(),
    );
    for (const k of keys) expect(k).not.toMatch(/crewCodeEnc|crewCodeVersion|crewPaused|collage|zeffy|storageFolderKey|status|PurgedAt/);
  });
});

describe("cloneDraft and helpers", () => {
  it("uses the default name for the kind, never the source name, and takes dates and windows from the source", () => {
    const d = cloneDraft(source(), "practice");
    expect(d.name).toBe("Santa's Workshop dry run");
    expect(cloneDraft(source(), "real").name).toBe("A Visit to Santa's Workshop");
    expect(d.name).not.toBe("Source name");
    expect(d).toMatchObject({ kind: "practice", slug: "", dropoffDate: "2026-12-18", photoDate: "2026-12-19", pickupDate: "2026-12-20" });
    expect(d.windows).toEqual(source().windows);
    expect(cloneDraft(source()).kind).toBe("practice");
  });

  it("suggestCloneSlug differs from the source slug", () => {
    expect(suggestCloneSlug("practice", "2026-12-18", "practice-2026")).toBe("practice-2026-2");
    expect(suggestCloneSlug("real", "2026-12-18", "practice-2026")).toBe("workshop-2026");
  });

  it("isPastDay compares Eastern day strings, equal is not past", () => {
    expect(isPastDay("2026-11-03", "2026-11-04")).toBe(true);
    expect(isPastDay("2026-11-04", "2026-11-04")).toBe(false);
    expect(isPastDay("2026-11-05", "2026-11-04")).toBe(false);
  });
});

describe("validateCreateSession cloneFrom", () => {
  const body = (extra: Record<string, unknown>) => ({ ...request(), ...extra });

  it("accepts a uuid cloneFrom, rejects a non-uuid with field cloneFrom, and ignores posted questionMap, storageQuotaBytes and collageToken", () => {
    const ok = validateCreateSession(body({ cloneFrom: "11111111-1111-4111-8111-111111111111", questionMap: { snack: ["x"] }, storageQuotaBytes: 1, collageToken: "T" }));
    expect(ok).toMatchObject({ ok: true, value: { cloneFrom: "11111111-1111-4111-8111-111111111111" } });
    if (ok.ok) expect(Object.keys(ok.value)).not.toEqual(expect.arrayContaining(["questionMap"]));
    if (ok.ok) expect(JSON.stringify(ok.value)).not.toMatch(/collageToken|storageQuotaBytes|questionMap/);
    expect(validateCreateSession(body({ cloneFrom: "not-a-uuid" }))).toMatchObject({ ok: false, field: "cloneFrom" });
    expect(validateCreateSession(body({ cloneFrom: 5 }))).toMatchObject({ ok: false, field: "cloneFrom" });
    const plain = validateCreateSession(request());
    expect(plain.ok && "cloneFrom" in plain.value).toBe(false);
  });
});
