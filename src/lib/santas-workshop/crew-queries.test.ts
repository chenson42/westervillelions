import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: async () => false }));

import type { CrewRosterRow } from "./crew-contract";
import { toCrewRow, sortCrewRows, type CrewRowSource } from "./crew-queries";
import { alreadyPickedUp, confirmMove, confirmReplace, crewAuthRequired, crewError, crewOk, holderAdvanced, staleState, storageFailure } from "./crew-http";
import { failureResponse, refusalResponse } from "./crew-respond";
import { StorageFull, StorageMisconfigured, StorageRateLimited, StorageUnavailable } from "./photo-store/errors";

const src = (over: Partial<CrewRowSource["stuffy"]> = {}, order: Partial<CrewRowSource["order"]> = {}): CrewRowSource => ({
  stuffy: { id: "s1", orderId: "o1", name: "Barnaby", description: "Brown bear".padEnd(200, "x"), state: "tagged", tagCode: "https://vendor.example.invalid/s/abcd1234", needsAttention: false, ...over },
  order: { windowId: "w1", refundStatus: "none", refundedCents: 0, paymentDeleted: false, refundResolutionCents: null, ...order },
  orderSize: 2,
  hasCheckInPhoto: true,
  hasPortrait: false,
});

describe("toCrewRow", () => {
  it("returns only the fields of the contract: no contact, no ids from Zeffy, no notes", () => {
    const row = toCrewRow({ ...src(), buyerEmail: "a@example.invalid", buyerPhone: "6145550100", parentName: "Pat Example" } as CrewRowSource);
    expect(Object.keys(row).sort()).toEqual(["description", "detailsBeingChecked", "hasCheckInPhoto", "hasPortrait", "id", "last4", "name", "orderId", "orderSize", "refundBadge", "state", "windowId"].sort());
    expect(JSON.stringify(row)).not.toMatch(/example\.invalid|6145550100|Pat/);
  });

  it("shows the description's first 80 characters and only the last 4 of the sticker (never a link)", () => {
    const row = toCrewRow(src());
    expect(row.description).toHaveLength(80);
    expect(row.last4).toBe("1234");
    expect(JSON.stringify(row)).not.toContain("vendor.example.invalid");
  });

  it("the refund badge is the worker's grey badge: a full refund or removed payment, never a partial one, and Keep clears it", () => {
    expect(toCrewRow(src({}, { refundStatus: "full", refundedCents: 5000 })).refundBadge).toBe(true);
    expect(toCrewRow(src({}, { paymentDeleted: true })).refundBadge).toBe(true);
    expect(toCrewRow(src({}, { refundStatus: "partial", refundedCents: 1000 })).refundBadge).toBe(false);
    expect(toCrewRow(src({}, { refundStatus: "full", refundedCents: 5000, refundResolutionCents: 5000 })).refundBadge).toBe(false);
  });

  it("an unknown stored state falls back to registered rather than leaking a bad value", () => {
    expect(toCrewRow(src({ state: "garbage" })).state).toBe("registered");
  });
});

describe("sortCrewRows", () => {
  const row = (id: string, name: string | null, windowId: string | null, refundBadge = false): CrewRosterRow => ({ ...toCrewRow(src({ id, name })), windowId, refundBadge });
  const windows = [{ id: "w1" }, { id: "w2" }];

  it("orders by window, then name, with refunded rows sunk to the bottom", () => {
    const sorted = sortCrewRows([row("a", "Zed", "w1"), row("b", "Amy", "w2"), row("c", "Bo", "w1"), row("d", "Aaa", "w1", true)], windows);
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("unmapped windows and nameless rows go last", () => {
    const sorted = sortCrewRows([row("x", null, "w1"), row("y", "Yara", null), row("z", "Zoe", "w1")], windows);
    expect(sorted.map((r) => r.id)).toEqual(["z", "x", "y"]);
  });
});

describe("response helpers", () => {
  it("every crew response is no-store and noindex", () => {
    for (const res of [crewOk({ ok: true }), crewError(400, "invalid_input", "x"), crewAuthRequired(), staleState("tagged", new Date())]) {
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    }
  });

  it("typed conflicts carry what the screen needs", async () => {
    expect(await confirmMove("Barnaby").json()).toMatchObject({ code: "confirm_move", otherStuffyName: "Barnaby" });
    expect(await confirmReplace("1234").json()).toMatchObject({ code: "confirm_replace", oldLast4: "1234" });
    expect(await holderAdvanced("Barnaby").json()).toMatchObject({ code: "holder_advanced" });
    expect(await alreadyPickedUp(new Date("2026-12-18T22:00:00Z")).json()).toMatchObject({ code: "already_picked_up", at: "2026-12-18T22:00:00.000Z" });
    expect(await staleState("tagged", new Date("2026-12-18T22:00:00Z")).json()).toMatchObject({ code: "stale_state", currentState: "tagged" });
  });

  it("failureResponse maps every transition failure to a status and a contract code", async () => {
    const cases: [Parameters<typeof failureResponse>[0], number, string][] = [
      [{ ok: false, code: "not_found" }, 404, "not_found"],
      [{ ok: false, code: "stale_state", currentState: "tagged", since: new Date() }, 409, "stale_state"],
      [{ ok: false, code: "withdrawn" }, 409, "withdrawn"],
      [{ ok: false, code: "illegal_transition", currentState: "tagged" }, 409, "illegal_transition"],
      [{ ok: false, code: "already_picked_up", at: new Date() }, 409, "already_picked_up"],
      [{ ok: false, code: "pickup_check_required" }, 409, "pickup_check_required"],
      [{ ok: false, code: "name_not_shown" }, 409, "name_not_shown"],
      [{ ok: false, code: "portrait_exists" }, 409, "portrait_exists"],
      [{ ok: false, code: "practice_only" }, 403, "practice_only"],
      [{ ok: false, code: "confirm_move", otherStuffyName: "B" }, 409, "confirm_move"],
      [{ ok: false, code: "confirm_replace", oldLast4: "1234" }, 409, "confirm_replace"],
      [{ ok: false, code: "holder_advanced", otherStuffyName: "B" }, 409, "holder_advanced"],
      [{ ok: false, code: "tag_already_bound" }, 409, "tag_already_bound"],
      [{ ok: false, code: "withdraw_not_allowed", currentState: "checked_in" }, 409, "illegal_transition"],
      [{ ok: false, code: "invalid_input", error: "bad" }, 400, "invalid_input"],
    ];
    for (const [failure, status, code] of cases) {
      const res = failureResponse(failure);
      expect(res.status, failure.code).toBe(status);
      expect((await res.json()).code, failure.code).toBe(code);
    }
  });

  it("upload refusals map to 413, 415, 429 and 400", () => {
    const status = (code: Parameters<typeof refusalResponse>[0]["code"]) => refusalResponse({ ok: false, upload: true, code, error: "x" }).status;
    expect(status("too_large")).toBe(413);
    expect(status("quota_exceeded")).toBe(413);
    expect(status("not_jpeg")).toBe(415);
    expect(status("rate_limited")).toBe(429);
    expect(status("invalid_input")).toBe(400);
  });

  it("a store failure is a 503 with the storage code and a retryable flag, never the original message", async () => {
    const cases: [Error, string, boolean][] = [
      [new StorageUnavailable(), "storage_unavailable", true],
      [new StorageRateLimited(), "storage_rate_limited", true],
      [new StorageMisconfigured("Drive refused access"), "storage_misconfigured", false],
      [new StorageFull(), "storage_full", false],
    ];
    for (const [error, code, retryable] of cases) {
      const res = storageFailure(error)!;
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code, retryable });
    }
    expect(storageFailure(new Error("db down"))).toBeNull();
  });
});
