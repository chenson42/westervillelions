import { describe, expect, it } from "vitest";
import { CREW_ERROR_CODES, type CrewErrorBody } from "@/lib/santas-workshop/crew-contract";
import { AUTH_REASON_MESSAGES, CREW_FAILURE_COPY, NETWORK_FAILURE_MESSAGE, STORAGE_DOWN_MESSAGE, crewFailureMessage, isCrewErrorCode, type CrewAction } from "./crew-messages";

const ACTIONS: CrewAction[] = ["enter", "roster", "search", "scan", "view", "tag", "check_in", "portrait", "group_photo", "pickup_check", "pickup", "revert"];

/** One representative body per code, built by hand so a new code in the contract fails here until it is written. */
function bodyFor(code: (typeof CREW_ERROR_CODES)[number]): CrewErrorBody {
  switch (code) {
    case "crew_auth_required":
      return { error: "That code didn't work. Ask the event chair.", code };
    case "throttled":
      return { error: "That code didn't work. Ask the event chair. Wait a few minutes.", code };
    case "stale_state":
      return { error: "x", code, currentState: "tagged", since: "2026-12-19T15:00:00.000Z" };
    case "confirm_move":
    case "holder_advanced":
      return { error: "x", code, otherStuffyName: "Pip" };
    case "confirm_replace":
      return { error: "x", code, oldLast4: "AB12" };
    case "already_picked_up":
      return { error: "x", code, at: "2026-12-20T20:00:00.000Z" };
    case "storage_unavailable":
    case "storage_misconfigured":
    case "storage_full":
    case "storage_rate_limited":
      return { error: "x", code, retryable: code === "storage_unavailable" };
    default:
      return { error: "x", code };
  }
}

describe("crew failure copy", () => {
  it("has a non-empty sentence for every code in the crew contract", () => {
    for (const code of CREW_ERROR_CODES) {
      expect(CREW_FAILURE_COPY[code], code).toBeTruthy();
      expect(CREW_FAILURE_COPY[code].length, code).toBeGreaterThan(10);
    }
    expect(Object.keys(CREW_FAILURE_COPY).sort()).toEqual([...CREW_ERROR_CODES].sort());
  });

  it("gives a sentence for every code under every action, and never leaks a raw status, 'error' or the storage vendor", () => {
    for (const code of CREW_ERROR_CODES) {
      for (const action of ACTIONS) {
        const text = crewFailureMessage(bodyFor(code), action);
        expect(text, `${code}/${action}`).toBeTruthy();
        expect(text, `${code}/${action}`).not.toMatch(/drive|google|\bhttp\b|\b[45]\d\d\b|exception|undefined|\[object/i);
        expect(text, `${code}/${action}`).not.toBe("x");
      }
    }
  });

  it("says the same plain sentence for every storage failure that is not temporary, naming no vendor", () => {
    expect(STORAGE_DOWN_MESSAGE).toBe("Photos can't be saved right now. They're kept on this phone. Tell the chair.");
    for (const code of ["storage_unavailable", "storage_misconfigured", "storage_full"] as const) {
      expect(crewFailureMessage(bodyFor(code), "check_in")).toBe(STORAGE_DOWN_MESSAGE);
    }
  });

  it("shows the sign-out reason only when the server revealed one", () => {
    expect(crewFailureMessage({ error: "x", code: "crew_auth_required", reason: "paused" }, "roster")).toBe(AUTH_REASON_MESSAGES.paused);
    expect(crewFailureMessage({ error: "x", code: "crew_auth_required", reason: "closed" }, "roster")).toBe(AUTH_REASON_MESSAGES.closed);
    expect(crewFailureMessage({ error: "x", code: "crew_auth_required", reason: "signed_out" }, "roster")).toBe(AUTH_REASON_MESSAGES.signed_out);
    expect(crewFailureMessage({ error: "x", code: "crew_auth_required" }, "roster")).toBe(CREW_FAILURE_COPY.crew_auth_required);
  });

  it("at the code screen a rejected code reads as the server's uniform sentence, with or without a body", () => {
    expect(crewFailureMessage({ error: "That code didn't work. Ask the event chair.", code: "crew_auth_required" }, "enter")).toBe("That code didn't work. Ask the event chair.");
    expect(crewFailureMessage({ error: "", code: "crew_auth_required" }, "enter")).toBe("That code didn't work. Ask the event chair.");
  });

  it("shows the throttle sentence as the server wrote it (it carries the wait)", () => {
    expect(crewFailureMessage({ error: "That code didn't work. Ask the event chair. Wait a few minutes.", code: "throttled" }, "enter")).toContain("Wait a few minutes");
  });

  it("names the other stuffy in collision answers and the last four in a replace", () => {
    expect(crewFailureMessage(bodyFor("confirm_move"), "tag")).toContain("Pip");
    expect(crewFailureMessage(bodyFor("holder_advanced"), "tag")).toContain("Pip");
    expect(crewFailureMessage(bodyFor("confirm_replace"), "tag")).toContain("AB12");
  });

  it("treats a missing body as a connection problem", () => {
    expect(crewFailureMessage(null, "scan")).toBe(NETWORK_FAILURE_MESSAGE);
  });

  it("refines a few codes per action", () => {
    expect(crewFailureMessage({ error: "x", code: "invalid_input" }, "enter")).not.toBe(CREW_FAILURE_COPY.invalid_input);
    expect(crewFailureMessage({ error: "x", code: "invalid_input" }, "scan")).toContain("sticker");
  });

  it("recognises codes", () => {
    expect(isCrewErrorCode("stale_state")).toBe(true);
    expect(isCrewErrorCode("made_up")).toBe(false);
    expect(isCrewErrorCode(5)).toBe(false);
  });
});
