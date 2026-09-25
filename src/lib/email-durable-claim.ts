/**
 * The sanctioned entrypoint pair for any caller that will persist a
 * DURABLE, hard-to-reverse "this was sent" claim — an append-only decision
 * history row, a partial-unique-indexed "success" row, an atomic
 * sentAt/sentVia claim, or any future equivalent (DECISION-102 rule 2).
 *
 * `sendEmail()`/`sendBulkMemberEmail()` (src/lib/email.ts) remain the
 * correct entrypoint for the ~16 ordinary call sites that hold no durable
 * claim — their contract is untouched (DECISION-085). This file exists
 * because an optional field on that ordinary result type (`blocked`,
 * `notAttempted`) is a fact a durable-claim caller can always choose not to
 * look at, and that mistake has shipped twice already
 * (docs/work-log/2026-09-25-financial-report-auto-send.md,
 * docs/work-log/2026-09-25-ack-letter-blocked-claim.md). `DurableSendResult`
 * has NO `success` field anywhere in its type, so a durable-claim caller
 * that adopts it cannot compile `if (result.success)` — see DECISION-103.
 */

import { sendEmail, sendBulkMemberEmail } from "@/lib/email";
import type { SendEmailOptions, SendBulkMemberEmailOptions } from "@/lib/email";

/**
 * The outcome of an attempted send, for a caller about to write a durable
 * "this was sent" claim. Deliberately has NO `success` boolean: the defect
 * this exists to make unrepresentable is exactly "a caller read `success`
 * and skipped the rest of the story."
 *
 * `not_delivered` collapses two reasons that both mean "nothing reached
 * Resend" but differ in what a human reading /admin should be told:
 *   - "blocked_non_production": the deny-by-default guard refused to reach
 *     Resend (DECISION-085).
 *   - "dev_no_api_key": no RESEND_API_KEY is configured outside production.
 * Both revert a durable claim identically; only the displayed reason
 * differs. See DECISION-103.
 */
export type DurableSendOutcome =
  | { outcome: "delivered" }
  | { outcome: "failed"; error: string }
  | { outcome: "not_delivered"; reason: "blocked_non_production" | "dev_no_api_key" };

export type DurableSendResult = { emailQueueId: string } & DurableSendOutcome;

function outcomeFromRaw(raw: {
  success: boolean;
  error?: string;
  blocked?: true;
  notAttempted?: true;
}): DurableSendOutcome {
  if (raw.blocked) return { outcome: "not_delivered", reason: "blocked_non_production" };
  if (raw.notAttempted) return { outcome: "not_delivered", reason: "dev_no_api_key" };
  if (!raw.success) return { outcome: "failed", error: raw.error ?? "Unknown error" };
  return { outcome: "delivered" };
}

/**
 * The sanctioned entrypoint for any caller that will persist a durable
 * "this was sent" claim from a single-recipient send. Thin wrapper over
 * sendEmail() — same queue row, same guard, same retry behavior; only the
 * shape of what's returned differs.
 */
export async function sendEmailForDurableClaim(
  options: SendEmailOptions,
): Promise<DurableSendResult> {
  const raw = await sendEmail(options);
  return { emailQueueId: raw.emailQueueId, ...outcomeFromRaw(raw) };
}

export interface SendBulkMemberEmailForDurableClaimResult {
  results: Array<{ to: string; emailQueueId: string } & DurableSendOutcome>;
}

/**
 * The sanctioned entrypoint for any caller that will persist a durable
 * "this was sent" claim from a batch send. Thin wrapper over
 * sendBulkMemberEmail() — reuses its one recipient loop; does not
 * reimplement it (CLAUDE.md's duplication rule).
 */
export async function sendBulkMemberEmailForDurableClaim(
  options: SendBulkMemberEmailOptions,
): Promise<SendBulkMemberEmailForDurableClaimResult> {
  const { results } = await sendBulkMemberEmail(options);
  return {
    results: results.map((r) => ({ to: r.to, emailQueueId: r.emailQueueId, ...outcomeFromRaw(r) })),
  };
}
