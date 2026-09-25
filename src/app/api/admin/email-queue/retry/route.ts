import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailQueue, type EmailQueueItem } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { and, eq, inArray, lte } from "drizzle-orm";
import { Resend } from "resend";
import { shouldBlockNonProductionSend } from "@/lib/email-guard";
import { attemptResendSend } from "@/lib/email-send-attempt";
import { resetStaleRetryingEmails } from "@/lib/email-queue-stats";

const RETRY_BACKOFF_MS = 15 * 60 * 1000;

/**
 * Atomically claims one `failed` row for retry, mirroring
 * `ledger-acknowledgment-letter-queries.ts`'s "atomic on purpose" claim
 * (CLAUDE.md cites it by name): `UPDATE ... WHERE id = $id AND status =
 * 'failed' RETURNING id`, run BEFORE any send is attempted. A concurrent
 * request racing for the same row (a fast double-click, two admins on the
 * same row, or an overlapping bulk sweep + targeted click) will see zero
 * rows back and must not send — see the regression test QA left in
 * route.test.ts (docs/work-log/2026-09-25-email-silent-success.md, "Per-
 * Message Retry (Follow-Up #3)" Phase 5 FAIL).
 *
 * The claim marks the row `status: "retrying"` and bumps `attempts` in the
 * SAME statement, so the attempt count is only ever incremented once per
 * actual retry — every caller downstream reuses the returned `attempts`
 * value rather than incrementing again.
 *
 * `"retrying"` is meant to be a transient status: it only exists between this
 * claim and the terminal update a few lines later in the same request, and
 * `settleClaim()` below guarantees it always moves to a terminal status even
 * if something inside the try block throws unexpectedly. But a JS
 * `try/catch` cannot survive a hard process death (a Vercel function
 * timeout, an instance being killed, a deploy landing mid-request) — so this
 * claim also stamps `retryingAt` with the claim time. That's the sole signal
 * `resetStaleRetryingEmails()` (src/lib/email-queue-stats.ts) has to tell "a
 * request is still genuinely holding this row" apart from "the process died
 * and this row is stranded," and it's what lets a stranded row recover
 * without a manual SQL fix. See
 * docs/work-log/2026-09-25-retry-stranding.md (B-66).
 */
async function claimFailedRow(
  id: string,
  currentAttempts: number,
  now: Date
): Promise<{ claimed: true; attempts: number } | { claimed: false }> {
  const attempts = currentAttempts + 1;
  const [claim] = await db
    .update(emailQueue)
    .set({ status: "retrying", attempts, retryingAt: now })
    .where(and(eq(emailQueue.id, id), eq(emailQueue.status, "failed")))
    .returning({ id: emailQueue.id });

  if (!claim) return { claimed: false };
  return { claimed: true, attempts };
}

/**
 * Sends (or reports blocked-on-missing-key for) one already-claimed row, and
 * always leaves it in a terminal status — never stranded at `"retrying"`.
 * A thrown error from anywhere in this path (not just a Resend rejection,
 * which attemptSend() already catches) reverts the row to `failed` with a
 * generic error rather than leaving it claimed-but-never-settled — this is
 * the answer to "what happens if the claim succeeds but the send then
 * fails": the row always ends up back in `failed`, retryable, with a real
 * error, never in `retrying` forever.
 */
async function settleClaim(
  item: EmailQueueItem,
  resend: Resend | null,
  now: Date,
  attempts: number
): Promise<{ success: boolean; error?: string; countsAsFailed: boolean }> {
  try {
    // GUARDRAIL — runs BEFORE the missing-key check, mirroring sendEmail()'s
    // own ordering. This route bypasses sendEmail() entirely (DECISION-092)
    // and previously had NO deny-by-default check outside production at
    // all — see docs/work-log/2026-09-25-email-silent-success.md, "Per-
    // Message Retry (Follow-Up #3)" Phase 5, finding 2. Reuses `sent`'s
    // sibling status `blocked_non_production` so this shows up in the
    // existing "Not Sent (Non-Production)" admin section with no new UI.
    if (shouldBlockNonProductionSend(item.to)) {
      console.warn(
        `[Email Queue Retry] BLOCKED: refusing to retry ${item.id} (to: ${item.to}) from a ` +
          `non-production process. Queued as blocked; nothing was delivered. To receive mail ` +
          `while developing, add the address to EMAIL_DEV_ALLOWLIST in .env.local.`
      );
      await db
        .update(emailQueue)
        .set({ status: "blocked_non_production", attempts, retryingAt: null })
        .where(eq(emailQueue.id, item.id));
      return {
        success: false,
        error: "Blocked — non-production deny-by-default guard (EMAIL_DEV_ALLOWLIST)",
        countsAsFailed: false,
      };
    }

    if (!resend) {
      return await handleMissingApiKey(item, now, attempts);
    }

    const outcome = await attemptSend(resend, item);
    if (outcome.success) {
      await db
        .update(emailQueue)
        .set({ status: "sent", sentAt: now, attempts, lastError: null, retryingAt: null })
        .where(eq(emailQueue.id, item.id));
      return { success: true, countsAsFailed: false };
    }

    const nextRetryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
    await db
      .update(emailQueue)
      .set({ status: "failed", attempts, lastError: outcome.error, nextRetryAt, retryingAt: null })
      .where(eq(emailQueue.id, item.id));
    return { success: false, error: outcome.error, countsAsFailed: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Email Queue Retry] Unexpected error settling claim for ${item.id}: ${errMsg}`);
    const nextRetryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
    await db
      .update(emailQueue)
      .set({ status: "failed", attempts, lastError: errMsg, nextRetryAt, retryingAt: null })
      .where(eq(emailQueue.id, item.id));
    return { success: false, error: errMsg, countsAsFailed: true };
  }
}

interface TargetedResult {
  id: string;
  success: boolean;
  error?: string;
}

type SendableQueueItem = Pick<EmailQueueItem, "from" | "to" | "subject" | "html" | "attachments">;

/**
 * (Re)sends one persisted email_queue row directly via Resend, bypassing
 * sendEmail() entirely (DECISION-092: this route re-sends the row's own
 * persisted `to`/`attachments`/etc. rather than going through the queue
 * helper — see the attachment-forwarding tests below).
 *
 * The send-and-classify step itself (inspecting Resend's `{ data, error }`
 * return value, which the SDK resolves rather than throws on an API-level
 * rejection) is shared with `sendEmail()`'s loop in `src/lib/email.ts` via
 * `attemptResendSend()` (src/lib/email-send-attempt.ts) — see that module's
 * doc comment for why the extraction exists. This function makes exactly
 * one attempt per invocation (retries here happen across separate admin
 * clicks or sweep passes, not within one call) and deliberately ignores the
 * shared helper's `retryable` classification — a retried row always lands
 * back in `failed` either way, same as before this extraction.
 */
async function attemptSend(
  resend: Resend,
  item: SendableQueueItem
): Promise<{ success: true } | { success: false; error: string }> {
  const outcome = await attemptResendSend(resend, {
    from: item.from,
    to: item.to,
    subject: item.subject,
    html: item.html,
    // DECISION-092: forward a persisted attachments array so a retried
    // announcement (or any future attachment-bearing send) doesn't
    // silently arrive without its calendar invite.
    attachments: item.attachments ?? undefined,
  });

  if (outcome.success) return { success: true };
  return { success: false, error: outcome.error };
}

/**
 * Same defect class as sendEmail()'s old "dev mode" branch
 * (docs/work-log/2026-09-25-email-silent-success.md): this route bypasses
 * sendEmail() entirely and re-sends the persisted queue row directly, so it
 * needs its own production guard rather than inheriting sendEmail()'s fix.
 * Unconditionally marking "sent" here would let an admin's retry click
 * silently re-lose a message that failed for the exact reason being
 * retried.
 *
 * `attempts` is the value already written by claimFailedRow()'s atomic
 * claim — this function reuses it rather than incrementing again, so a
 * retry only ever counts as one attempt.
 *
 * Callers must run shouldBlockNonProductionSend() FIRST — this function
 * does not check it — mirroring sendEmail()'s own ordering (the allowlist
 * gate runs before the missing-key check).
 */
async function handleMissingApiKey(
  item: EmailQueueItem,
  now: Date,
  attempts: number
): Promise<{ success: false; error: string; countsAsFailed: boolean }> {
  if (process.env.NODE_ENV === "production") {
    const errMsg = "RESEND_API_KEY is not configured — email was not sent";
    console.error(`[Email Queue Retry] ${errMsg} (id: ${item.id})`);
    const nextRetryAt = new Date(now.getTime() + RETRY_BACKOFF_MS);
    await db
      .update(emailQueue)
      .set({ status: "failed", attempts, lastError: errMsg, nextRetryAt, retryingAt: null })
      .where(eq(emailQueue.id, item.id));
    return { success: false, error: errMsg, countsAsFailed: true };
  }

  // Non-production — nothing was actually sent; keep it out of both 'sent'
  // and 'failed' so the queue doesn't lie either way.
  console.log(`[Email Queue Retry] Dev mode (no RESEND_API_KEY) — NOT sending ${item.id}`);
  await db
    .update(emailQueue)
    .set({ status: "dev_no_api_key", attempts, retryingAt: null })
    .where(eq(emailQueue.id, item.id));
  return {
    success: false,
    error: "No RESEND_API_KEY configured in this environment — not sent",
    countsAsFailed: false,
  };
}

/**
 * Targeted retry: an explicit admin click on ONE specific failed row.
 *
 * Deliberately bypasses the `nextRetryAt` cooldown that gates bulk retry.
 * The two modes differ on purpose: bulk retry is an unattended sweep, so it
 * only picks up rows whose backoff has elapsed, to avoid hammering a
 * still-down provider. Targeted retry is a human looking at ONE row,
 * reading its error, and choosing to try again right now — that explicit
 * choice IS the eligibility check, and gating it on `nextRetryAt` would
 * make the button appear to work while silently no-op'ing on exactly the
 * rows an admin most wants to retry (all 36 production rows from the
 * 2026-09-25 outage have `nextRetryAt = NULL`, which `NULL <= now()` never
 * satisfies).
 *
 * Still refuses to touch a row that isn't `status = 'failed'` — retrying an
 * already-`sent` (or `pending`) row is how a donor or member ends up with a
 * duplicate email.
 */
async function handleTargetedRetry(ids: string[], resend: Resend | null, now: Date) {
  const rows = await db.select().from(emailQueue).where(inArray(emailQueue.id, ids));

  const results: TargetedResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    const item = rows.find((r) => r.id === id);

    if (!item) {
      results.push({ id, success: false, error: "Email not found" });
      failed++;
      continue;
    }

    if (item.status !== "failed") {
      results.push({
        id,
        success: false,
        error: `Cannot retry a message with status "${item.status}"`,
      });
      failed++;
      continue;
    }

    // Atomic claim BEFORE any send is attempted — see claimFailedRow()'s
    // doc comment. A lost race (another concurrent request already claimed
    // this row) is reported, never silently retried a second time.
    const claim = await claimFailedRow(id, item.attempts, now);
    if (!claim.claimed) {
      results.push({
        id,
        success: false,
        error: "Already being retried — refresh and try again",
      });
      failed++;
      continue;
    }

    const outcome = await settleClaim(item, resend, now, claim.attempts);
    results.push({ id, success: outcome.success, ...(outcome.error && { error: outcome.error }) });
    if (outcome.success) succeeded++;
    else if (outcome.countsAsFailed) failed++;
  }

  return NextResponse.json({ mode: "targeted", retried: ids.length, succeeded, failed, results });
}

/**
 * Existing untargeted sweep — same `nextRetryAt`-gated eligibility as
 * before, now claiming each row atomically before sending so an overlapping
 * bulk sweep (two admins clicking "Retry Failed Emails" at once, or a bulk
 * sweep racing a targeted click on the same row) can't double-send either.
 * A row that loses the claim race is simply skipped by this run — it was
 * already claimed by whichever concurrent request got there first, and that
 * request's own accounting covers it.
 *
 * Also runs `resetStaleRetryingEmails()` first (see that function's doc
 * comment, src/lib/email-queue-stats.ts) — this is one of the two places a
 * row stranded at `retrying` by a hard process death gets a chance to
 * self-heal back to `failed`, the other being a read of `/admin/email-queue`
 * itself. Safe to call every time: it only ever touches rows well past the
 * point a live request could still be holding them.
 */
async function handleBulkRetry(resend: Resend | null, now: Date) {
  await resetStaleRetryingEmails(now);

  const eligible = await db
    .select()
    .from(emailQueue)
    .where(and(eq(emailQueue.status, "failed"), lte(emailQueue.nextRetryAt, now)));

  if (eligible.length === 0) {
    return NextResponse.json({ mode: "bulk", retried: 0, succeeded: 0, failed: 0 });
  }

  let succeeded = 0;
  let failed = 0;

  for (const item of eligible) {
    const claim = await claimFailedRow(item.id, item.attempts, now);
    if (!claim.claimed) continue;

    const outcome = await settleClaim(item, resend, now, claim.attempts);
    if (outcome.success) succeeded++;
    else if (outcome.countsAsFailed) failed++;
  }

  return NextResponse.json({ mode: "bulk", retried: eligible.length, succeeded, failed });
}

/**
 * POST /api/admin/email-queue/retry
 *
 * No body (or a body without a non-empty `ids` array): retries all failed
 * emails whose `next_retry_at` has elapsed (existing bulk sweep behavior,
 * unchanged).
 *
 * `{ ids: string[] }`: retries exactly those rows, ignoring `next_retry_at`
 * — see handleTargetedRetry() for why. Returns a per-id `results` array so
 * the UI can report each row's outcome, not just an aggregate count.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const canManage = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let ids: string[] | undefined;
  try {
    const body: unknown = await request.json();
    if (
      body &&
      typeof body === "object" &&
      "ids" in body &&
      Array.isArray((body as { ids: unknown }).ids)
    ) {
      const candidate = (body as { ids: unknown[] }).ids.filter(
        (v): v is string => typeof v === "string" && v.length > 0
      );
      if (candidate.length > 0) ids = candidate;
    }
  } catch {
    // No body, or invalid JSON — treat as the existing untargeted/bulk request.
  }

  const now = new Date();
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  if (ids) {
    return handleTargetedRetry(ids, resend, now);
  }

  return handleBulkRetry(resend, now);
}
