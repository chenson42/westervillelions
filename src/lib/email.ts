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

interface SendEmailOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
  replyTo?: string;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
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
  const { to, from, subject, html, replyTo } = options;

  // Persist to queue first
  const [queued] = await db
    .insert(emailQueue)
    .values({ to, from, subject, html, status: "pending" })
    .returning({ id: emailQueue.id });

  // GUARDRAIL: never deliver to a real club distribution list from a non-production
  // process. On 2026-08-09 a QA run of the minutes email feature sent a genuine message
  // to club@westervillelions.org — the club's ~44-person Google Group — because
  // `.env.local` carries the production RESEND_API_KEY and `next dev` re-reads it,
  // defeating a shell-level override. The addresses are real Google Groups with no
  // sandbox in front of them, so a mistake here reaches members immediately and cannot
  // be recalled. Queue the message and report success so callers and their tests behave
  // normally; simply do not hand it to Resend.
  if (process.env.NODE_ENV !== "production" && isClubDistributionList(to)) {
    console.warn(
      `[Email] BLOCKED: refusing to send to the real distribution list ${to} from a ` +
        `non-production process. Queued as blocked; nothing was delivered.`,
    );
    await db
      .update(emailQueue)
      .set({ status: "blocked_non_production", attempts: 0 })
      .where(eq(emailQueue.id, queued.id));
    return { success: true };
  }

  // Dev mode — no API key
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email] To: ${to} | Subject: ${subject}`);
    await db
      .update(emailQueue)
      .set({ status: "sent", sentAt: new Date(), attempts: 1 })
      .where(eq(emailQueue.id, queued.id));
    return { success: true };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await resend.emails.send({ from, to: [to], subject, html, ...(replyTo && { replyTo }) });

      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: new Date(), attempts: attempt })
        .where(eq(emailQueue.id, queued.id));

      return { success: true };
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

  return { success: false, error: lastError };
}
