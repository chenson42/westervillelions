import { Resend } from "resend";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { shouldBlockNonProductionSend } from "@/lib/email-guard";
import { attemptResendSend } from "@/lib/email-send-attempt";

/**
 * A MIME attachment for an outbound email. `content` is the raw text (e.g. a
 * full .ics calendar string) — Resend's SDK/API handles encoding, so callers
 * never base64-encode client-side. Persisted verbatim on the email_queue row
 * so the deferred admin-retry path (src/app/api/admin/email-queue/retry/route.ts),
 * which re-sends a queued row directly rather than replaying the original
 * sendEmail() call, can forward it too. See DECISION-092.
 */
export interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

// Exported (was file-private) so src/lib/email-durable-claim.ts can name it
// in its own signatures. No change to the shape or meaning of any field.
export interface SendEmailOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  attachments?: EmailAttachment[];
  /**
   * @internal Set only by sendBulkMemberEmail() below — never set this from
   * feature code directly. Widens the non-production guard unconditionally
   * (no address matching) for any call flagged this way. See DECISION-085.
   */
  _bulkMemberSend?: boolean;
}

// Exported (was file-private) so src/lib/email-durable-claim.ts can name it.
// Shape unchanged except the addition of `notAttempted` below — DECISION-103.
//
// IMPORTANT FOR ANY CALLER THAT WILL PERSIST A DURABLE "THIS WAS SENT" CLAIM
// (an append-only decision history row, a partial-unique-indexed "success"
// row, an atomic sentAt/sentVia claim, or any future equivalent —
// DECISION-102 rule 2): do not read `success`/`blocked`/`notAttempted` off
// this type directly. Use `sendEmailForDurableClaim()` /
// `sendBulkMemberEmailForDurableClaim()` from
// src/lib/email-durable-claim.ts instead, whose result type has no bare
// `success` field to accidentally stop at. See DECISION-103.
export interface SendEmailResult {
  success: boolean;
  error?: string;
  /** The persisted email_queue row id — present whether the send succeeded,
   *  failed, or was blocked, so a caller that wants to link a domain record
   *  (e.g. dues_reminders.emailQueueId) to the delivery record can do so
   *  without a second lookup. Additive — every existing caller destructures
   *  only { success, error } today and is unaffected. */
  emailQueueId: string;
  /**
   * Set only on the `blocked_non_production` path below — never present on
   * a genuine success or a genuine failure. `success: true` on that path is
   * deliberate and load-bearing (DECISION-085: callers and their tests must
   * behave exactly as in production) and this field does NOT change that
   * contract — it's a non-breaking, additive way for a caller that cares to
   * tell "delivered" apart from "reported success because nothing was ever
   * attempted." Every existing caller destructures only `{ success, error }`
   * and ignores this field, so nothing about their behavior changes.
   *
   * Added for docs/work-log/2026-09-25-financial-report-auto-send.md's
   * follow-up: `sendMonthlyReportToBoard()` (src/lib/financial-report-send.ts)
   * was writing a durable `success: true` claim row for a blocked send,
   * which is both a false record and — because of the partial unique index
   * on (entity_id, month_end, totals_fingerprint) WHERE success — permanent,
   * making that statement un-resendable in dev forever after the first
   * local test. See that file for the consuming logic.
   */
  blocked?: true;
  /**
   * NEW (DECISION-103, B-70). Set only on the `dev_no_api_key` branch below
   * — non-production, no RESEND_API_KEY configured, recipient already
   * cleared the deny-by-default guard above. As undelivered as `blocked` is,
   * for exactly the same reason (nothing was handed to the Resend SDK), but
   * kept as its own field rather than folded into `blocked` so that field's
   * existing, precise contract ("set only on the blocked_non_production
   * path") stays literally true for every reader who already trusts it.
   * A durable-claim caller must treat `blocked` and `notAttempted`
   * identically — see src/lib/email-durable-claim.ts, the only place that
   * needs to know that. Every existing caller destructures only
   * `{ success, error }` and ignores this field, so nothing about their
   * behavior changes.
   */
  notAttempted?: true;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const RETRY_MINUTES = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send an email via Resend with up to 3 in-request retry attempts.
 * The email is persisted to email_queue before the first attempt so that
 * failed deliveries can be retried later via the admin retry endpoint.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, from, subject, html, replyTo, cc, bcc, attachments, _bulkMemberSend } = options;

  // Persist to queue first
  const [queued] = await db
    .insert(emailQueue)
    .values({
      to,
      from,
      subject,
      html,
      cc: cc ?? null,
      bcc: bcc ?? null,
      attachments: attachments ?? null,
      status: "pending",
    })
    .returning({ id: emailQueue.id });

  // GUARDRAIL: outside production, deliver to NOBODY unless explicitly allowlisted.
  //
  // This is deny-by-default, and it is deliberately the opposite of what it used to
  // be. The original guard blocked two named distribution lists and let everything
  // else through, which failed twice:
  //
  //   2026-08-09  A QA run of the minutes email sent a real message to
  //               club@westervillelions.org, the club's ~44-person Google Group.
  //               The response was to add those two addresses to a deny-list.
  //   2026-08-12  A QA run of the treasury CC rule created a pending disbursement in
  //               dev, which fired the pre-existing board-approval notification and
  //               sent 16 real board members a fake $500 approval request. That path
  //               was not a distribution list and not a bulk send, so neither clause
  //               applied. The deny-list had simply never heard of it.
  //
  // The lesson of the second incident is that a deny-list can only protect the paths
  // somebody remembered to enumerate, and this codebase has ~18 sendEmail call sites.
  // So the question is now inverted: a non-production process may send to an address
  // only if that address was deliberately allowlisted. A new feature, a new call site,
  // or a member added to dev data after this code was written is blocked by default.
  //
  // `.env.local` carries the production RESEND_API_KEY and `next dev` re-reads it, so
  // a shell-level override does not survive — the block has to live here, in code.
  //
  // Blocked messages are still queued and still report success, so callers and their
  // tests behave exactly as in production; the message simply never reaches Resend,
  // and is visible at /admin/email-queue as `blocked_non_production`.
  // `_bulkMemberSend` bypasses the allowlist entirely — a bulk member send is
  // blocked outside production even if the recipient IS allowlisted. That is
  // DECISION-085's actual guarantee ("unconditionally blocks non-production
  // delivery for any bulk-individual-recipient send — no address matching"),
  // and until 2026-09-10 it was NOT implemented: the flag was destructured here
  // and then never read, so the documented promise was simply false.
  //
  // Why it matters even though the allowlist is already deny-by-default: the
  // allowlist is per-address, and a developer legitimately puts their OWN
  // address in EMAIL_DEV_ALLOWLIST to receive test mail. The moment that
  // address also appears in a member list, a bulk send reaches them for real —
  // which is exactly the "one real message escaped a QA run" shape this guard
  // exists to make impossible. Gating on call SHAPE (bulk vs. single) rather
  // than on the recipient is the whole point: it cannot be defeated by dev data
  // the guard has never heard of.
  //
  // The predicate itself lives in src/lib/email-guard.ts, shared with the
  // admin email-queue retry route — see that file's doc comment for why a
  // second call site needs it.
  if (shouldBlockNonProductionSend(to, { bulk: _bulkMemberSend })) {
    console.warn(
      `[Email] BLOCKED: refusing to send to ${to} from a non-production process. ` +
        `Queued as blocked; nothing was delivered. To receive mail while developing, ` +
        `add the address to EMAIL_DEV_ALLOWLIST in .env.local.`,
    );
    await db
      .update(emailQueue)
      .set({ status: "blocked_non_production", attempts: 0 })
      .where(eq(emailQueue.id, queued.id));
    return { success: true, emailQueueId: queued.id, blocked: true };
  }

  // No API key configured. This branch used to report success unconditionally —
  // in production that turned a total mail outage into a silent success, writing
  // `status: 'sent'` into email_queue as false evidence that delivery happened.
  // ~34 messages were lost this way over 2026-08-28 through 2026-09-25 before
  // Resend's own dashboard (1 send in 30 days) exposed the gap against
  // email_queue's ~35 "sent" rows in the same window. See
  // docs/work-log/2026-09-25-email-silent-success.md.
  if (!process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      const lastError = "RESEND_API_KEY is not configured — email was not sent";
      console.error(`[Email] ${lastError} (to: ${to}, subject: ${subject})`);
      const nextRetryAt = new Date(Date.now() + RETRY_MINUTES * 60 * 1000);
      await db
        .update(emailQueue)
        .set({ status: "failed", lastError, attempts: 1, nextRetryAt })
        .where(eq(emailQueue.id, queued.id));
      return { success: false, error: lastError, emailQueueId: queued.id };
    }

    // Non-production, key absent, and the recipient already cleared the
    // deny-by-default guard above (allowlisted or NODE_ENV==='production',
    // which can't be true here). Nothing was actually sent — a distinct
    // status (never 'sent') keeps that honest for a developer reading
    // /admin/email-queue or the DB directly, while still returning
    // success: true so local/manual testing of a feature's happy path
    // doesn't have to special-case "no Resend key in .env.local".
    console.log(`[Email] DEV (no RESEND_API_KEY — not actually sent) To: ${to} | Subject: ${subject}`);
    await db
      .update(emailQueue)
      .set({ status: "dev_no_api_key", attempts: 1 })
      .where(eq(emailQueue.id, queued.id));
    return { success: true, emailQueueId: queued.id, notAttempted: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let lastError: string | undefined;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    // The send-and-classify step (inspecting Resend's `{ data, error }`
    // return value, which the SDK resolves rather than throws on an
    // API-level rejection) is shared with the admin email-queue retry
    // route's single-attempt send — see src/lib/email-send-attempt.ts's doc
    // comment for why that extraction exists and what it does and doesn't
    // own.
    const outcome = await attemptResendSend(resend, { from, to, subject, html, replyTo, cc, bcc, attachments });

    if (outcome.success) {
      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: new Date(), attempts: attempt })
        .where(eq(emailQueue.id, queued.id));

      return { success: true, emailQueueId: queued.id };
    }

    lastError = outcome.error;
    if (outcome.retryable && attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    // Permanent error (or out of attempts) — stop now rather than burning
    // the remaining attempts on a request that will fail identically every
    // time.
    break;
  }

  // All attempts failed (or a permanent error stopped us early) — mark for
  // deferred retry. `attempts` reflects the number of attempts actually
  // made, not always MAX_ATTEMPTS, so a permanent error recorded on the
  // first try doesn't misreport itself as having been retried 3 times.
  const nextRetryAt = new Date(Date.now() + RETRY_MINUTES * 60 * 1000);
  await db
    .update(emailQueue)
    .set({
      status: "failed",
      lastError,
      attempts: attemptsMade,
      nextRetryAt,
    })
    .where(eq(emailQueue.id, queued.id));

  return { success: false, error: lastError, emailQueueId: queued.id };
}

// ---------------------------------------------------------------------------
// sendBulkMemberEmail — the sanctioned entrypoint for "email many individual
// members at once" (DECISION-085 / DECISION-086).
// ---------------------------------------------------------------------------

export interface SendBulkMemberEmailRecipient {
  to: string;
  /** Pre-rendered per-recipient HTML body; subject is shared across the batch. */
  html: string;
}

export interface SendBulkMemberEmailOptions {
  from: string;
  subject: string;
  replyTo?: string;
  bcc?: string;
  /**
   * Copied on EVERY message in the batch. Added 2026-09-10 so the ledger
   * approval notifications could migrate off a hand-rolled sendEmail() loop
   * without changing who sees what: the treasury CC rule (DECISION-086) puts
   * the treasurer on the visible Cc line of each approval email, and dropping
   * to Bcc to fit the old options shape would have silently changed that.
   */
  cc?: string;
  /**
   * Shared across every recipient in the batch — the same .ics file (one
   * occurrence or a full series) is identical for every recipient, so it
   * belongs on the batch options, not per-recipient.
   */
  attachments?: EmailAttachment[];
  recipients: SendBulkMemberEmailRecipient[];
}

export interface SendBulkMemberEmailResult {
  results: Array<{
    to: string;
    success: boolean;
    error?: string;
    emailQueueId: string;
    /** Mirrors SendEmailResult.blocked 1:1 — forwarded from this recipient's
     *  own sendEmail() call. Added for DECISION-103/B-70: previously this
     *  shape did not forward `blocked` at all, forcing
     *  emailAcknowledgmentLetters() to infer it from an email_queue
     *  read-back instead. See src/lib/email-durable-claim.ts. */
    blocked?: true;
    /** Mirrors SendEmailResult.notAttempted 1:1 — see that field's doc
     *  comment. */
    notAttempted?: true;
  }>;
}

/**
 * Send the same subject to many individual members, one sendEmail() call per
 * recipient. Every call is made with _bulkMemberSend: true, which widens
 * sendEmail()'s non-production guard UNCONDITIONALLY — no address matching,
 * so a member added to dev/QA data after this code was written still gets
 * blocked. This is the load-bearing safety property (DECISION-085): a dev
 * or QA run of a bulk-member-email feature must never be able to reach a
 * real member's inbox. Reuses sendEmail()'s own queue-insert/blocked-status
 * write; nothing is duplicated. One recipient's failure never aborts the
 * others' sends.
 *
 * This is the expected entrypoint for any future "email many members at
 * once" feature — do not hand-loop sendEmail() directly for that shape.
 */
export async function sendBulkMemberEmail(
  options: SendBulkMemberEmailOptions,
): Promise<SendBulkMemberEmailResult> {
  const { from, subject, replyTo, cc, bcc, attachments, recipients } = options;
  const results: SendBulkMemberEmailResult["results"] = [];
  for (const r of recipients) {
    const result = await sendEmail({
      to: r.to,
      from,
      subject,
      html: r.html,
      replyTo,
      cc,
      bcc,
      attachments,
      _bulkMemberSend: true,
    });
    results.push({
      to: r.to,
      success: result.success,
      error: result.error,
      emailQueueId: result.emailQueueId,
      ...(result.blocked ? { blocked: true as const } : {}),
      ...(result.notAttempted ? { notAttempted: true as const } : {}),
    });
  }
  return { results };
}
