import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { and, eq, lte } from "drizzle-orm";
import { Resend } from "resend";

/**
 * POST /api/admin/email-queue/retry
 * Admin-only endpoint to retry all failed emails whose next_retry_at has elapsed.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();

  const eligible = await db
    .select()
    .from(emailQueue)
    .where(
      and(
        eq(emailQueue.status, "failed"),
        lte(emailQueue.nextRetryAt, now)
      )
    );

  if (eligible.length === 0) {
    return NextResponse.json({ retried: 0, succeeded: 0, failed: 0 });
  }

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  let succeeded = 0;
  let failed = 0;

  for (const item of eligible) {
    if (!resend) {
      // Dev mode — mark as sent
      console.log(`[Email Queue Retry] Dev mode — marking ${item.id} sent`);
      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: now, attempts: item.attempts + 1 })
        .where(eq(emailQueue.id, item.id));
      succeeded++;
      continue;
    }

    try {
      await resend.emails.send({
        from: item.from,
        to: [item.to],
        subject: item.subject,
        html: item.html,
      });

      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: now, attempts: item.attempts + 1, lastError: null })
        .where(eq(emailQueue.id, item.id));

      succeeded++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const nextRetryAt = new Date(now.getTime() + 15 * 60 * 1000);

      await db
        .update(emailQueue)
        .set({
          attempts: item.attempts + 1,
          lastError: errMsg,
          nextRetryAt,
        })
        .where(eq(emailQueue.id, item.id));

      failed++;
    }
  }

  return NextResponse.json({ retried: eligible.length, succeeded, failed });
}
