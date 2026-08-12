import { Resend } from "resend";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CLUB_GROUP_EMAIL, BOARD_EMAIL } from "@/lib/club-contacts";

/**
 * The club's real Google Group distribution lists. Mail to these reaches the whole
 * membership or the whole board at once and cannot be recalled — see the guardrail in
 * sendEmail(). Compared case-insensitively and ignoring any display-name wrapper.
 */
const CLUB_DISTRIBUTION_LISTS: readonly string[] = [CLUB_GROUP_EMAIL, BOARD_EMAIL];

function isClubDistributionList(to: string): boolean {
  // Accept both "a@b.org" and "Name <a@b.org>" forms.
  const address = (to.match(/<([^>]+)>/)?.[1] ?? to).trim().toLowerCase();
  return CLUB_DISTRIBUTION_LISTS.some((list) => list.toLowerCase() === address);
}


/**
 * Addresses a non-production process is permitted to mail, from
 * EMAIL_DEV_ALLOWLIST (comma-separated). Empty or unset means nothing sends,
 * which is the correct default: a developer who has not thought about it does
 * not mail the club.
 *
 * Match your own address here to receive test mail while developing. Never add
 * a club distribution list, and never add another member's address.
 */
function isDevAllowedRecipient(to: string): boolean {
  const raw = process.env.EMAIL_DEV_ALLOWLIST;
  if (!raw) return false;
  const address = (to.match(/<([^>]+)>/)?.[1] ?? to).trim().toLowerCase();
  if (isClubDistributionList(address)) return false; // never, allowlist or not
  return raw
    .split(",")
    .map((a) => (a.match(/<([^>]+)>/)?.[1] ?? a).trim().toLowerCase())
    .filter(Boolean)
    .includes(address);
}

interface SendEmailOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  /**
   * @internal Set only by sendBulkMemberEmail() below — never set this from
   * feature code directly. Widens the non-production guard unconditionally
   * (no address matching) for any call flagged this way. See DECISION-085.
   */
  _bulkMemberSend?: boolean;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  /** The persisted email_queue row id — present whether the send succeeded,
   *  failed, or was blocked, so a caller that wants to link a domain record
   *  (e.g. dues_reminders.emailQueueId) to the delivery record can do so
   *  without a second lookup. Additive — every existing caller destructures
   *  only { success, error } today and is unaffected. */
  emailQueueId: string;
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
  const { to, from, subject, html, replyTo, cc, bcc, _bulkMemberSend } = options;

  // Persist to queue first
  const [queued] = await db
    .insert(emailQueue)
    .values({ to, from, subject, html, cc: cc ?? null, bcc: bcc ?? null, status: "pending" })
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
  if (process.env.NODE_ENV !== "production" && !isDevAllowedRecipient(to)) {
    console.warn(
      `[Email] BLOCKED: refusing to send to ${to} from a non-production process. ` +
        `Queued as blocked; nothing was delivered. To receive mail while developing, ` +
        `add the address to EMAIL_DEV_ALLOWLIST in .env.local.`,
    );
    await db
      .update(emailQueue)
      .set({ status: "blocked_non_production", attempts: 0 })
      .where(eq(emailQueue.id, queued.id));
    return { success: true, emailQueueId: queued.id };
  }

  // Dev mode — no API key
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email] To: ${to} | Subject: ${subject}`);
    await db
      .update(emailQueue)
      .set({ status: "sent", sentAt: new Date(), attempts: 1 })
      .where(eq(emailQueue.id, queued.id));
    return { success: true, emailQueueId: queued.id };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await resend.emails.send({
        from,
        to: [to],
        subject,
        html,
        ...(replyTo && { replyTo }),
        ...(cc && { cc: [cc] }),
        ...(bcc && { bcc: [bcc] }),
      });

      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: new Date(), attempts: attempt })
        .where(eq(emailQueue.id, queued.id));

      return { success: true, emailQueueId: queued.id };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All attempts failed — mark for deferred retry
  const nextRetryAt = new Date(Date.now() + RETRY_MINUTES * 60 * 1000);
  await db
    .update(emailQueue)
    .set({
      status: "failed",
      lastError,
      attempts: MAX_ATTEMPTS,
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
  recipients: SendBulkMemberEmailRecipient[];
}

export interface SendBulkMemberEmailResult {
  results: Array<{ to: string; success: boolean; error?: string; emailQueueId: string }>;
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
  const { from, subject, replyTo, bcc, recipients } = options;
  const results: SendBulkMemberEmailResult["results"] = [];
  for (const r of recipients) {
    const result = await sendEmail({
      to: r.to,
      from,
      subject,
      html: r.html,
      replyTo,
      bcc,
      _bulkMemberSend: true,
    });
    results.push({
      to: r.to,
      success: result.success,
      error: result.error,
      emailQueueId: result.emailQueueId,
    });
  }
  return { results };
}
