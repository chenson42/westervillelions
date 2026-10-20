/**
 * The one place a "pending your approval" email is composed and sent to the
 * `ledger.approve` holders (B-172 Increment 2a, break site 21).
 *
 * Before this module the same resolve-approvers, resolve-treasurer, compose,
 * `sendBulkMemberEmail()` block was written twice inside
 * POST /api/admin/ledger/transactions (expense branch and Transfer/Sweep
 * branch) and a third copy was about to be added for the itemized sweep
 * batch. Every caller now goes through `notifyPendingApprovers()`.
 *
 * Best effort and isolated: it NEVER throws, so it can never fail the write
 * that triggered it. The failure is logged with `console.error` (a silent
 * catch hid a dead notification path from QA on 2026-10-10; do not make it
 * silent again). Outbound mail is deny-by-default outside production inside
 * `sendBulkMemberEmail()` (2026-08-12 incident), so this module adds no guard
 * of its own.
 *
 * Not a durable-claim path: nothing here records that anything was "sent",
 * so DECISION-102/103 helpers are not required.
 *
 * Server-only (imports the database through ledger-queries).
 */

import { FEATURES } from "@/lib/permissions";
import { getEmailsForFeature } from "@/lib/ledger-queries";
import { sendBulkMemberEmail } from "@/lib/email";
import {
  getFromEmail,
  buildApprovalReviewUrl,
  buildPendingApprovalEmailHtml,
} from "@/lib/email-compose";
import { resolveTreasurer } from "@/lib/board-positions";

export interface PendingApproverNotice {
  noun: "disbursement" | "transfer" | "sweep";
  /** Full email subject, e.g. `Disbursement pending your approval - $12.00`. */
  subject: string;
  amountDollars: string;
  txnDate: string;
  party?: string | null;
  memo?: string | null;
  /** The row the Approvals deep link targets (the expense leg for a pair or batch). */
  reviewTxnId: string | undefined;
  /** Present for an itemized sweep: the body then names a count and no party or memo. */
  batch?: { count: number };
}

export async function notifyPendingApprovers(notice: PendingApproverNotice): Promise<void> {
  try {
    const approverEmails = await getEmailsForFeature(FEATURES.LEDGER_APPROVE);
    const fromEmail = getFromEmail();
    // Treasury CC rule (DECISION-086): resolved once, tolerant of failure.
    const treasurer = await resolveTreasurer();
    if (!treasurer.ok) {
      console.warn(`[Ledger email] Treasurer CC skipped: ${treasurer.reason}`);
    }
    const html = buildPendingApprovalEmailHtml({
      noun: notice.noun,
      amountDollars: notice.amountDollars,
      txnDate: notice.txnDate,
      party: notice.party ?? null,
      memo: notice.memo ?? null,
      reviewUrl: buildApprovalReviewUrl(notice.reviewTxnId),
      ...(notice.batch ? { batch: notice.batch } : {}),
    });
    // sendBulkMemberEmail(), NOT a hand-rolled loop over sendEmail().
    await sendBulkMemberEmail({
      from: fromEmail,
      subject: notice.subject,
      ...(treasurer.ok ? { cc: treasurer.email } : {}),
      recipients: approverEmails.map((email) => ({ to: email, html })),
    });
  } catch (error) {
    console.error("[Ledger email] Approver notification failed:", error);
  }
}
