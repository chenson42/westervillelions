import { describe, expect, it } from "vitest";
import { MANUAL_REASON_MAX, MANUAL_REASON_MIN, validateManualAdd } from "./manual-add";

const windows = [{ id: "fri-1700" }, { id: "fri-1800" }];
const good = {
  parentFirstName: "Pat",
  parentLastName: "Example",
  stuffyName: "Barnaby",
  windowId: "fri-1700",
  reason: "Called the hotline; paid by check",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

describe("validateManualAdd", () => {
  it("accepts the phone-usable minimum and nulls the optional fields", () => {
    const r = validateManualAdd(good, windows);
    expect(r).toMatchObject({
      ok: true,
      value: { parentFirstName: "Pat", stuffyName: "Barnaby", description: null, snack: null, parentEmail: null, parentPhone: null, photoConsent: false },
    });
  });

  it("requires parent first and last name, stuffy name, a window, a reason and a request id", () => {
    for (const key of ["parentFirstName", "parentLastName", "stuffyName", "windowId", "reason", "idempotencyKey"]) {
      const r = validateManualAdd({ ...good, [key]: "" }, windows);
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.field).toBe(key);
    }
  });

  it("the reason is required, trimmed, at least the minimum and at most the maximum", () => {
    expect(validateManualAdd({ ...good, reason: "   " }, windows)).toMatchObject({ ok: false, field: "reason" });
    expect(validateManualAdd({ ...good, reason: "x".repeat(MANUAL_REASON_MIN - 1) }, windows)).toMatchObject({ ok: false, field: "reason" });
    expect(validateManualAdd({ ...good, reason: "x".repeat(MANUAL_REASON_MAX + 1) }, windows)).toMatchObject({ ok: false, field: "reason" });
    expect(validateManualAdd({ ...good, reason: "x".repeat(MANUAL_REASON_MAX) }, windows).ok).toBe(true);
  });

  it("the window must be one of the session's windows", () => {
    expect(validateManualAdd({ ...good, windowId: "sat-0900" }, windows)).toMatchObject({ ok: false, field: "windowId" });
    expect(validateManualAdd({ ...good, windowId: 5 }, windows)).toMatchObject({ ok: false, field: "windowId" });
  });

  it("an email, when given, must look like one; a phone is kept as typed", () => {
    expect(validateManualAdd({ ...good, parentEmail: "not-an-email" }, windows)).toMatchObject({ ok: false, field: "parentEmail" });
    const r = validateManualAdd({ ...good, parentEmail: " pat@example.invalid ", parentPhone: "ext 5 desk line" }, windows);
    expect(r).toMatchObject({ ok: true, value: { parentEmail: "pat@example.invalid", parentPhone: "ext 5 desk line" } });
  });

  it("the request id must be a uuid", () => {
    expect(validateManualAdd({ ...good, idempotencyKey: "abc" }, windows)).toMatchObject({ ok: false, field: "idempotencyKey" });
  });

  it("consent is opt-in: only a literal true counts", () => {
    expect(validateManualAdd({ ...good, photoConsent: "yes" }, windows)).toMatchObject({ ok: true, value: { photoConsent: false } });
    expect(validateManualAdd({ ...good, photoConsent: true }, windows)).toMatchObject({ ok: true, value: { photoConsent: true } });
  });

  it("rejects non-object bodies and non-text fields", () => {
    expect(validateManualAdd(null, windows).ok).toBe(false);
    expect(validateManualAdd([], windows).ok).toBe(false);
    expect(validateManualAdd({ ...good, description: 12 }, windows)).toMatchObject({ ok: false, field: "description" });
  });

  it("HTML in a name is kept verbatim as text (React escapes it on render)", () => {
    const r = validateManualAdd({ ...good, stuffyName: "<b>Bear</b>" }, windows);
    expect(r).toMatchObject({ ok: true, value: { stuffyName: "<b>Bear</b>" } });
  });
});
