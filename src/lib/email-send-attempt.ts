import type { Resend } from "resend";
import type { EmailAttachment } from "@/lib/email";

/**
 * The single source of truth for "call the Resend SDK once, and correctly
 * tell a rejected send apart from a delivered one." Extracted from
 * `sendEmail()`'s in-loop attempt (src/lib/email.ts) and the admin retry
 * route's `attemptSend()` (src/app/api/admin/email-queue/retry/route.ts),
 * which had implemented this same inspection twice — see CLAUDE.md's
 * duplication rule ("the same decision implemented in more than two
 * places") and docs/work-log/2026-09-25-shared-resend-attempt.md (B-68).
 *
 * The retry route was fixed for the unchecked-`error` defect first;
 * `sendEmail()` picked up the identical fix a day later, and the two
 * implementations drifted apart with only two-way pointer comments holding
 * them together. That gap is exactly how a month-long silent outbound-mail
 * outage (docs/work-log/2026-09-25-email-silent-success.md) went
 * undetected: a future fix to one silently leaving the other wrong.
 *
 * This module holds ONLY the pure send-and-classify step, with no
 * `@/lib/db` import and no queue-row writes, retry scheduling, or
 * deny-by-default guard — those differ legitimately between the two
 * callers (see DECISION-092: the retry route deliberately bypasses
 * `sendEmail()` to resend a persisted row's own `to`/`attachments` rather
 * than re-queuing through it), in the same spirit as `src/lib/email-guard.ts`
 * holding only the deny-by-default predicate.
 */

/** The subset of resend.emails.send()'s options both callers ever populate. */
export interface ResendSendAttemptInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  attachments?: EmailAttachment[];
}

export type ResendSendAttemptResult =
  | { success: true }
  | {
      success: false;
      error: string;
      /**
       * Whether this failure is worth retrying immediately. `false` only
       * when the Resend SDK returned a recognized permanent error code
       * (see `PERMANENT_RESEND_ERROR_CODES` below) — a bad/revoked API key,
       * an unverified sending domain, a malformed payload, and so on, all
       * of which fail identically on every attempt. Everything else
       * (a transport-level throw, a recognized transient code like
       * `rate_limit_exceeded`, or any code the SDK introduces after this
       * list was written) is `true`. Guessing a *new* code is permanent
       * risks silently giving up on something that would have succeeded a
       * second later; guessing a known-permanent code is retryable only
       * costs a little time. Callers that make a single attempt per
       * invocation (the retry route) are free to ignore this field.
       */
      retryable: boolean;
    };

/**
 * Resend error codes (from `RESEND_ERROR_CODE_KEY` in the SDK's types,
 * which the package does not export, so this list is hand-kept in sync with
 * it) that will fail identically on every attempt — a bad/revoked API key,
 * an unverified sending domain, a malformed payload, an invalid address,
 * and so on. Retrying one of these burns attempts and adds latency for no
 * benefit (harmless, but pointless).
 *
 * Everything NOT in this list — including a genuinely transient condition
 * like `rate_limit_exceeded`, and any error code the SDK introduces after
 * this list was written — is treated as retryable. That is a deliberate
 * conservative default: guessing a *new* code is permanent risks silently
 * giving up on something that would have succeeded a second later, where
 * guessing a known-permanent code is retryable only costs a little time.
 */
const PERMANENT_RESEND_ERROR_CODES = new Set<string>([
  "invalid_idempotency_key",
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "not_found",
  "method_not_allowed",
  "invalid_idempotent_request",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "security_error",
]);

function isRetryableResendError(code: string | undefined): boolean {
  return code === undefined || !PERMANENT_RESEND_ERROR_CODES.has(code);
}

/**
 * Makes exactly one call to `resend.emails.send()` and classifies the
 * outcome. Does not retry, sleep, or touch the database — callers own their
 * own retry loop (`sendEmail()`) or single-attempt-per-invocation shape
 * (the admin retry route).
 *
 * IMPORTANT — do not remove the `result.error` check below. Resend's SDK
 * (v6) resolves with `{ data: null, error }` on an API-level rejection
 * (revoked/invalid key, unverified sending domain, exceeded quota,
 * suppressed recipient, malformed payload, ...) — it does NOT throw for
 * those. Only a network/transport failure throws, which the catch block
 * below handles. Discarding the resolved value and treating `await` not
 * throwing as "sent" is the exact defect that produced the month-long
 * silent outbound-mail outage documented in
 * docs/work-log/2026-09-25-email-silent-success.md and its follow-up
 * docs/work-log/2026-09-25-sendemail-unchecked-error.md: the club's Resend
 * key was revoked for ~90 days while every one of ~98 attempted sends
 * landed `status: 'sent'` in email_queue with zero retries and zero
 * failures recorded, because nothing ever looked at what
 * `resend.emails.send()` resolved to.
 */
export async function attemptResendSend(
  resend: Resend,
  input: ResendSendAttemptInput,
): Promise<ResendSendAttemptResult> {
  const { from, to, subject, html, replyTo, cc, bcc, attachments } = input;
  try {
    const result = await resend.emails.send({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo && { replyTo }),
      ...(cc && { cc: [cc] }),
      ...(bcc && { bcc: [bcc] }),
      ...(attachments && { attachments }),
    });

    if (result?.error) {
      return {
        success: false,
        error: result.error.message ?? String(result.error),
        retryable: isRetryableResendError(result.error.name),
      };
    }

    return { success: true };
  } catch (err) {
    // A thrown transport/network error carries no Resend error code to
    // classify — always retryable, matching the pre-extraction behavior of
    // both callers (neither ever stopped retrying early on a thrown error).
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}
