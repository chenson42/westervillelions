/**
 * Maps a per-recipient DurableSendOutcome to the {success, error} pair every
 * durable-claim table (dues_reminders, event_announcements — and, in spirit,
 * financial_report_sends, which has its own untouched inline copy) persists.
 * Pure function, no I/O. Exists so this mapping — DECISION-102/103's rule
 * that `not_delivered` must never become success:true — has exactly one
 * home for its two NEW call sites (B-73), rather than being duplicated
 * again per route (CLAUDE.md's duplication rule: a third instance already
 * exists, untouched, in financial-report-send.ts — can't be folded in
 * today, see docs/work-log/2026-09-25-bulk-send-success-columns.md, Phase 3
 * Edge Cases).
 */

import type { DurableSendOutcome } from "@/lib/email-durable-claim";

export function durableOutcomeToRow(
  outcome: DurableSendOutcome,
): { success: boolean; error: string | null } {
  switch (outcome.outcome) {
    case "delivered":
      return { success: true, error: null };
    case "failed":
      return { success: false, error: outcome.error };
    case "not_delivered":
      return { success: false, error: NOT_DELIVERED_MESSAGES[outcome.reason] };
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`Unhandled send outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

const NOT_DELIVERED_MESSAGES: Record<
  Extract<DurableSendOutcome, { outcome: "not_delivered" }>["reason"],
  string
> = {
  blocked_non_production:
    "Blocked — outbound email is disabled outside production (EMAIL_DEV_ALLOWLIST). Nothing was delivered.",
  dev_no_api_key:
    "Blocked — no RESEND_API_KEY is configured outside production. Nothing was delivered.",
};
