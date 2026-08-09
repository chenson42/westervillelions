/**
 * POST /api/admin/minutes/[id]/email — the post-save "email these minutes"
 * send. Gate: minutes.manage.
 *
 * Body: { note?: string } — optional short note from the sender
 * (DECISION-075 §3), rendered above the minutes.
 *
 * Server resolves `resolveMinutesEmailTarget(minutes.kind, minutes.status)`
 * (src/lib/minutes.ts) — the single pure function encoding DECISION-075's
 * full gating table:
 *   - An unmapped kind -> 400, no email offered, no default address.
 *   - `general`/club-wide minutes -> 400 until status='approved' (the
 *     treasurer's send-gating decision: members must never receive a
 *     version that later changes).
 *   - `board` minutes -> allowed at any status, with a mandatory "DRAFT —
 *     subject to approval" banner in the body while status !== 'approved'.
 *
 * **The send result is surfaced to the caller at the moment of the
 * attempt — DECISION-075 §6.** `sendEmail()`'s own `{ success, error? }` is
 * passed straight through, 200 either way (a send failure is a SUCCESSFUL
 * API call reporting failure, not a 500) — a failed send must never look
 * like "saved" to the notetaker, and must never be silently swallowed into
 * the admin-only email_queue page they may never open.
 *
 * docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 "Email — full contract".
 *
 * Responses: 200 { success, error? } — sendEmail()'s own result, on a
 * successful attempt (whether the send itself succeeded or failed); 400
 * validation / gating rejection (sendEmail() never called); 401
 * unauthenticated; 403 forbidden; 404 not found.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { resolveMinutesEmailTarget } from "@/lib/minutes";
import { getMinutesDetail } from "@/lib/minutes-queries";
import { renderMinutesEmailHtml, capitalize } from "@/components/admin/minutes/minutes-email-render";
import { sendEmail } from "@/lib/email";

const NOTE_MAX_LEN = 1_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.MINUTES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const detail = await getMinutesDetail(id);
    // A soft-deleted record has nothing left to send — treat it the same as
    // "not found" rather than emailing a record an admin has removed.
    if (!detail || detail.pendingDeleteAt) {
      return NextResponse.json({ error: "Minutes record not found" }, { status: 404 });
    }

    const resolution = resolveMinutesEmailTarget(detail.kind, detail.status);
    if (!resolution.allowed) {
      return NextResponse.json({ error: resolution.reason }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const rawNote = body?.note;
    const note =
      typeof rawNote === "string" && rawNote.trim() ? rawNote.trim().slice(0, NOTE_MAX_LEN) : undefined;

    const html = await renderMinutesEmailHtml(detail, note);
    const subject = `${detail.title ? detail.title + " — " : ""}${capitalize(detail.kind)} Minutes — ${detail.meetingDate}`;
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";

    const result = await sendEmail({
      to: resolution.address,
      from: fromEmail,
      subject,
      html,
      ...(session.user.email ? { replyTo: session.user.email } : {}),
    });

    // sendEmail()'s own {success, error?} passed straight through, 200
    // either way — DECISION-075 §6.
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error sending minutes email:", error);
    return NextResponse.json({ error: "Failed to send minutes email" }, { status: 500 });
  }
}
