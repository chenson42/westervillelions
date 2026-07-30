/**
 * Unit tests for checkTransferDirection() (DECISION-058,
 * docs/work-log/2026-07-29-ledger-account-transfers.md) — one test per cell
 * of the Phase 1 directional allow-list matrix. Pure function, no mocking
 * required.
 */

import { describe, it, expect } from "vitest";
import { checkTransferDirection, type FundRef } from "./ledger-transfer-policy";

const clubAdmin: FundRef = { entityId: "club", fundId: "club-admin", kind: "administrative" };
const clubAdminPettyCash: FundRef = { entityId: "club", fundId: "club-admin", kind: "administrative" };
const clubActivity: FundRef = { entityId: "club", fundId: "club-activity", kind: "activity" };
const foundationCharitable: FundRef = {
  entityId: "foundation",
  fundId: "foundation-charitable",
  kind: "charitable",
};
// A hypothetical future second charitable/foundation-side fund, for the
// same-entity generic-block test — different fundId, same entity, kind not
// covered by an explicit branch.
const foundationScholarship: FundRef = {
  entityId: "foundation",
  fundId: "foundation-scholarship",
  kind: "scholarship",
};

describe("checkTransferDirection", () => {
  it("same fund (different bank account, checked by the caller) → allowed transfer, no board minute", () => {
    const result = checkTransferDirection(clubAdmin, clubAdminPettyCash);
    expect(result).toEqual({ allowed: true, mode: "transfer", requiresBoardMinute: false });
  });

  it("same entity, Activity -> Administrative → blocked with the specific reason", () => {
    const result = checkTransferDirection(clubActivity, clubAdmin);
    expect(result).toEqual({
      allowed: false,
      reason:
        "Activity Fund is public-facing pass-through money; it cannot be used to fund Club operations. See Activity Fund policy.",
    });
  });

  it("same entity, Administrative -> Activity → blocked with the specific reason", () => {
    const result = checkTransferDirection(clubAdmin, clubActivity);
    expect(result).toEqual({
      allowed: false,
      reason:
        "Administrative funds cannot be moved into the Activity Fund — the Activity Fund's income must stay publicly-sourced. See Activity Fund policy.",
    });
  });

  it("same entity, any other kind pair (forward-compat) → blocked with the generic reason", () => {
    const result = checkTransferDirection(foundationCharitable, foundationScholarship);
    expect(result).toEqual({
      allowed: false,
      reason: "Transfers between different funds within the same entity are not permitted.",
    });
  });

  it("cross-entity, Activity -> Charitable → allowed sweep, board minute required", () => {
    const result = checkTransferDirection(clubActivity, foundationCharitable);
    expect(result).toEqual({ allowed: true, mode: "sweep", requiresBoardMinute: true });
  });

  it("cross-entity, Charitable -> Activity → blocked, one-way-valve reason", () => {
    const result = checkTransferDirection(foundationCharitable, clubActivity);
    expect(result).toEqual({
      allowed: false,
      reason: "Charitable funds cannot be transferred back to the Club — this is a one-way flow by policy.",
    });
  });

  it("cross-entity, Charitable -> Administrative → blocked, one-way-valve reason", () => {
    const result = checkTransferDirection(foundationCharitable, clubAdmin);
    expect(result).toEqual({
      allowed: false,
      reason: "Charitable funds cannot be transferred back to the Club — this is a one-way flow by policy.",
    });
  });

  it("cross-entity, Administrative -> Charitable → blocked, 'not enabled yet' reason (Chris's deferred cell)", () => {
    const result = checkTransferDirection(clubAdmin, foundationCharitable);
    expect(result).toEqual({
      allowed: false,
      reason: "Administrative-to-Foundation gifts are not enabled yet — flagged for a future board decision.",
    });
  });

  it("cross-entity, Administrative -> Activity-kind-at-another-entity (nonsensical/forward-compat) → blocked, generic reason", () => {
    const foreignActivity: FundRef = { entityId: "foundation", fundId: "foundation-activity", kind: "activity" };
    const result = checkTransferDirection(clubAdmin, foreignActivity);
    expect(result).toEqual({
      allowed: false,
      reason: "This fund transfer direction is not permitted.",
    });
  });
});
