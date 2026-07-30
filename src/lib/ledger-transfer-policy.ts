/**
 * Directional allow-list for Ledger account-to-account transfers and the
 * cross-entity sweep (DECISION-058,
 * docs/work-log/2026-07-29-ledger-account-transfers.md).
 *
 * Pure, dependency-free, DB-free — takes primitive fund descriptors and
 * returns an allow/block decision. This is a pre-insert decision gate, not a
 * DB-querying reporting metric (contrast with the guardrail functions in
 * src/lib/ledger.ts, e.g. firewallViolations, which compute stats from an
 * already-fetched transaction list) — kept in its own file so every cell of
 * the Phase 1 directional matrix is a direct, unit-testable function call
 * with zero mocking.
 *
 * Deny-by-default: only two directions are allowed today —
 *   1. Same fund, different bank account (any entity) — "Transfer" — the
 *      Admin Checking <-> Petty Cash cash-management case.
 *   2. Club Activity fund -> Foundation Charitable fund (cross-entity) —
 *      "Sweep" — mandatory board-minute reference.
 * Every other direction is blocked with a specific policy reason so an
 * operator (or a client bypassing the UI) gets a self-correcting message,
 * not a generic "not allowed."
 *
 * Decided off fund `kind` + entity identity, NEVER hard-coded UUIDs — stable
 * across environments and fully unit-testable.
 */

export type TransferMode = "transfer" | "sweep";

export type TransferDirectionResult =
  | { allowed: true; mode: TransferMode; requiresBoardMinute: boolean }
  | { allowed: false; reason: string };

export interface FundRef {
  entityId: string;
  fundId: string;
  /** 'administrative' | 'activity' | 'charitable' | 'scholarship' (forward-compat) */
  kind: string;
}

/**
 * Decide whether money may move from `source` to `dest`.
 *
 * One `if` branch per matrix cell from Phase 1 (docs/work-log/
 * 2026-07-29-ledger-account-transfers.md, "The Directional Allow-List
 * Matrix"). Both Phase-1 UNDECIDED cells (Administrative -> Activity,
 * Administrative -> Foundation) are deny-by-default per Chris's locked
 * directive — coded as their own explicit, separately-worded blocks (not
 * folded into the generic catch-all) so a future Phase 6 override is a
 * one-branch flip with an existing unit-test slot.
 */
export function checkTransferDirection(
  source: FundRef,
  dest: FundRef,
): TransferDirectionResult {
  // Same fund → the Account-Transfer case (same-account no-op is checked
  // separately by the caller, since that needs both bankAccountIds, which
  // this function never sees). Different bank account on the same fund is
  // routine intra-fund cash management — no board-minute requirement.
  if (source.fundId === dest.fundId) {
    return { allowed: true, mode: "transfer", requiresBoardMinute: false };
  }

  if (source.entityId === dest.entityId) {
    // Same entity, different fund — deny-by-default. Today's only live case
    // is Activity <-> Administrative; both directions blocked per Chris's
    // locked decision. Any other same-entity fund pair (e.g. a future
    // scholarship fund) also falls through to the generic block, which is
    // correct deny-by-default behavior without enumerating funds that don't
    // exist yet.
    if (source.kind === "activity" && dest.kind === "administrative") {
      return {
        allowed: false,
        reason:
          "Activity Fund is public-facing pass-through money; it cannot be used to fund Club operations. See Activity Fund policy.",
      };
    }
    if (source.kind === "administrative" && dest.kind === "activity") {
      return {
        allowed: false,
        reason:
          "Administrative funds cannot be moved into the Activity Fund — the Activity Fund's income must stay publicly-sourced. See Activity Fund policy.",
      };
    }
    return {
      allowed: false,
      reason: "Transfers between different funds within the same entity are not permitted.",
    };
  }

  // Cross-entity
  if (source.kind === "charitable") {
    // One-way valve — charitable/deductible money can never flow back to a
    // non-501(c)(3) entity, in either destination direction.
    return {
      allowed: false,
      reason:
        "Charitable funds cannot be transferred back to the Club — this is a one-way flow by policy.",
    };
  }
  if (source.kind === "activity" && dest.kind === "charitable") {
    return { allowed: true, mode: "sweep", requiresBoardMinute: true };
  }
  if (source.kind === "administrative" && dest.kind === "charitable") {
    // Chris's deferred cell (Phase 1 Open Question #1 / Phase 6 override
    // candidate) — analyst recommended ALLOW ("Donate to Foundation"), not
    // enabled this increment.
    return {
      allowed: false,
      reason:
        "Administrative-to-Foundation gifts are not enabled yet — flagged for a future board decision.",
    };
  }
  return { allowed: false, reason: "This fund transfer direction is not permitted." };
}
