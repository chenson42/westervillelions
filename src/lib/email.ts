import { Resend } from "resend";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
