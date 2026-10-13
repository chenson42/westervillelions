import { describe, expect, it } from "vitest";
import { PICKUP_NOTE_MAX, parseAttempt, parseCheckInMeta, parseCheckInWithoutPhoto, parsePickup, parsePickupCheck, parsePickupName, parsePortraitMeta, parseRevert, parseTagRequest } from "./crew-input";

const KEY = "11111111-1111-4111-8111-111111111111";

describe("crew request validators", () => {
  it("tag: accepts a full request and normalizes the sticker text", () => {
    const r = parseTagRequest({ tagCode: "  ABC-1 ", expectedState: "registered", expectedTagCode: null, idempotencyKey: KEY, confirm: "move" });
    expect(r).toMatchObject({ ok: true, value: { tagCode: "ABC-1", expectedState: "registered", expectedTagCode: null, confirm: "move", idempotencyKey: KEY } });
  });

  it("tag: rejects a missing sticker, unknown state, non-uuid key, unknown confirm and a bad time", () => {
    const base = { tagCode: "A", expectedState: "registered", expectedTagCode: null, idempotencyKey: KEY };
    expect(parseTagRequest({ ...base, tagCode: "" }).ok).toBe(false);
    expect(parseTagRequest({ ...base, expectedState: "asleep" }).ok).toBe(false);
    expect(parseTagRequest({ ...base, idempotencyKey: "nope" }).ok).toBe(false);
    expect(parseTagRequest({ ...base, confirm: "delete" }).ok).toBe(false);
    expect(parseTagRequest({ ...base, clientTakenAt: "yesterday-ish" }).ok).toBe(false);
    expect(parseTagRequest({ ...base, expectedTagCode: 5 }).ok).toBe(false);
    expect(parseTagRequest(null).ok).toBe(false);
  });

  it("tag: expectedLast4 is optional text of at most four characters", () => {
    const base = { tagCode: "A", expectedState: "tagged", expectedTagCode: null, idempotencyKey: KEY };
    expect(parseTagRequest({ ...base, expectedLast4: "5678" })).toMatchObject({ ok: true, value: { expectedLast4: "5678" } });
    expect(parseTagRequest(base)).toMatchObject({ ok: true, value: { expectedLast4: null } });
    expect(parseTagRequest({ ...base, expectedLast4: "12345" }).ok).toBe(false);
    expect(parseTagRequest({ ...base, expectedLast4: 12 }).ok).toBe(false);
  });

  it("check-in without a photo needs withdrawn-free explicit intent and a tagged expectation", () => {
    expect(parseCheckInWithoutPhoto({ withoutPhoto: true, expectedState: "tagged", idempotencyKey: KEY })).toMatchObject({ ok: true });
    expect(parseCheckInWithoutPhoto({ expectedState: "tagged", idempotencyKey: KEY }).ok).toBe(false);
    expect(parseCheckInWithoutPhoto({ withoutPhoto: true, expectedState: "registered", idempotencyKey: KEY }).ok).toBe(false);
  });

  it("check-in and portrait photo metas pin the expected states", () => {
    expect(parseCheckInMeta({ expectedState: "tagged" }).ok).toBe(true);
    expect(parseCheckInMeta({ expectedState: "checked_in" }).ok).toBe(false);
    expect(parsePortraitMeta({ expectedState: "checked_in" })).toMatchObject({ ok: true, value: { replace: false } });
    expect(parsePortraitMeta({ expectedState: "portrait_taken", replace: true })).toMatchObject({ ok: true, value: { replace: true } });
    expect(parsePortraitMeta({ expectedState: "tagged" }).ok).toBe(false);
  });

  it("pickup-check: matched or someone_else, with a capped note", () => {
    expect(parsePickupCheck({ result: "matched", idempotencyKey: KEY })).toMatchObject({ ok: true, value: { note: null } });
    const long = parsePickupCheck({ result: "someone_else", note: "x".repeat(PICKUP_NOTE_MAX + 50), idempotencyKey: KEY });
    expect(long.ok && long.value.note?.length).toBe(PICKUP_NOTE_MAX);
    expect(parsePickupCheck({ result: "maybe", idempotencyKey: KEY }).ok).toBe(false);
  });

  it("pickup-name needs only a uuid request id", () => {
    expect(parsePickupName({ idempotencyKey: KEY }).ok).toBe(true);
    expect(parsePickupName({}).ok).toBe(false);
    expect(parsePickupName(null).ok).toBe(false);
  });

  it("pickup: only checked_in or portrait_taken may be expected", () => {
    expect(parsePickup({ expectedState: "portrait_taken", idempotencyKey: KEY }).ok).toBe(true);
    expect(parsePickup({ expectedState: "tagged", idempotencyKey: KEY }).ok).toBe(false);
    expect(parsePickup({ expectedState: "checked_in" }).ok).toBe(false);
  });

  it("revert: both states required and known", () => {
    expect(parseRevert({ toState: "registered", expectedState: "tagged" }).ok).toBe(true);
    expect(parseRevert({ toState: "nowhere", expectedState: "tagged" }).ok).toBe(false);
  });

  it("the attempt header defaults to 1 and is clamped to sane integers", () => {
    expect(parseAttempt(null)).toBe(1);
    expect(parseAttempt("3")).toBe(3);
    expect(parseAttempt("0")).toBe(1);
    expect(parseAttempt("999")).toBe(1);
    expect(parseAttempt("2.5")).toBe(1);
  });
});
