/**
 * Pending-acknowledgment queue — pure, DB-independent helpers backing
 * `AckQueue` (src/components/admin/ledger/ack-queue.tsx,
 * docs/work-log/2026-08-08-acknowledgment-donor-link.md, second increment).
 *
 * `listPendingAcknowledgments()` (src/lib/ledger-queries.ts) intentionally
 * returns two different states in one list: a transaction with no
 * acknowledgment at all, and a transaction with an acknowledgment already
 * recorded but not yet sent. Those states need different controls —
 * "Record acknowledgment" (POST, creates the ack) vs. "Mark Sent" (PATCH,
 * closes it out) — and offering the wrong one 409s (the server's own message
 * says "Use Mark Sent"). This file is the single place that decides which
 * one a row gets, kept separate from the component so the decision is
 * unit-testable without a DOM (this project's `vitest.config.ts` runs
 * `environment: "node"`, no RTL/jsdom — see CLAUDE.md).
 */

export type AckRowAction = "record" | "mark-sent";

/**
 * A row has an unsent acknowledgment iff `ackId` is non-null — see
 * `PendingAcknowledgmentRow.ackId`'s doc comment in `ledger-queries.ts`:
 * every row this query returns either has no ack row, or has one with
 * `sentAt IS NULL`, so `ackId !== null` alone is enough to tell the two
 * states apart without also checking `ackSentAt`.
 */
export function ackQueueRowAction(ackId: string | null): AckRowAction {
  return ackId !== null ? "mark-sent" : "record";
}

export type AckRowStatus = "unacknowledged" | "recorded";

/**
 * Legibility helper for the Status column — a treasurer should be able to
 * tell at a glance whether a gift has never been acknowledged or has been
 * acknowledged but not mailed yet. These are genuinely different states;
 * this must not collapse them to the same badge.
 */
export function ackQueueRowStatus(ackId: string | null): AckRowStatus {
  return ackId !== null ? "recorded" : "unacknowledged";
}
