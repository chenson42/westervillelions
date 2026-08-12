/**
 * GET /api/admin/dues/reminders?fiscalYear=2026 — cohort/signer preview
 * (the client's "Refresh list" action; page.tsx calls
 * getReminderCandidates()/resolveTreasurer() directly for first paint).
 *
 * POST /api/admin/dues/reminders — send. Body:
 *   { fiscalYear: number; memberIds: string[]; note?: string }
 *
 * Gate: BOTH handlers independently check auth() + hasFeature(DUES_MANAGE).
 * The proxy only admits this path at the weaker DUES_VIEW (derived from the
 * top-level "/admin/dues" nav entry) — relying on it would leak the
 * recipient list (names + emails + payment status) to a dues.view-only
 * account. admin-page-feature-gates.test.ts does not catch this because it
 * only walks top-level admin/ segments.
 *
 * docs/work-log/2026-08-12-dues-reminder-emails.md, Phase 3 §5.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { resolveTreasurer } from "@/lib/board-positions";
import { getReminderCandidates, insertDuesReminderRows } from "@/lib/dues-reminders-queries";
import { listMemberDuesStatus, getDuesSettings } from "@/lib/dues-queries";
import {
  seasonLabel,
  renderDuesReminderSubject,
  renderDuesReminderBody,
  classifyRecipients,
} from "@/lib/dues-reminders";
import { sendBulkMemberEmail } from "@/lib/email";
import type { NewDuesReminder } from "@/lib/db/schema";

const NOTE_MAX_LEN = 1_000;

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.DUES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fiscalYear = parsePositiveInt(request.nextUrl.searchParams.get("fiscalYear"));
    if (!fiscalYear) {
      return NextResponse.json(
        { error: "fiscalYear must be a positive integer" },
        { status: 400 },
      );
    }

    const [settings, signer, { unpaid, partial }] = await Promise.all([
      getDuesSettings(fiscalYear),
      resolveTreasurer(),
      getReminderCandidates(fiscalYear),
    ]);

    return NextResponse.json({
      fiscalYear,
      seasonLabel: seasonLabel(fiscalYear),
      duesSettings: settings
        ? {
            individualAmountCents: settings.individualAmountCents,
            familyAmountCents: settings.familyAmountCents,
          }
        : null,
      signer,
      unpaid,
      partial,
    });
  } catch (error) {
    console.error("Error loading dues reminder preview:", error);
    return NextResponse.json({ error: "Failed to load dues reminder preview" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.DUES_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    const fiscalYear =
      typeof body?.fiscalYear === "number" && Number.isInteger(body.fiscalYear) && body.fiscalYear > 0
        ? body.fiscalYear
        : null;
    if (!fiscalYear) {
      return NextResponse.json(
        { error: "fiscalYear must be a positive integer" },
        { status: 400 },
      );
    }

    const rawMemberIds = body?.memberIds;
    if (!Array.isArray(rawMemberIds) || rawMemberIds.length === 0) {
      return NextResponse.json({ error: "memberIds must be a non-empty array" }, { status: 400 });
    }
    if (!rawMemberIds.every((id) => typeof id === "string" && id.trim())) {
      return NextResponse.json({ error: "memberIds must all be non-empty strings" }, { status: 400 });
    }
    const memberIds: string[] = rawMemberIds;

    const rawNote = body?.note;
    const note =
      typeof rawNote === "string" && rawNote.trim() ? rawNote.trim().slice(0, NOTE_MAX_LEN) : null;

    // 1. Resolve the signer. Hard block on failure — no letter signed by
    //    nobody (DECISION-086, distinct from the five treasury emails'
    //    tolerant CC failure mode below).
    const treasurer = await resolveTreasurer();
    if (!treasurer.ok) {
      return NextResponse.json(
        {
          error:
            "No single Treasurer found in the Board of Directors group — fix the group position before sending reminders.",
          reason: treasurer.reason,
          ...(treasurer.boardGroupId ? { boardGroupId: treasurer.boardGroupId } : {}),
        },
        { status: 400 },
      );
    }

    // 2. Dues amounts must come from this fiscal year's dues_settings row —
    //    never hard-coded. Without it there is no rate sentence to render.
    const settings = await getDuesSettings(fiscalYear);
    if (!settings) {
      return NextResponse.json(
        { error: "Dues amounts are not configured for this fiscal year." },
        { status: 400 },
      );
    }

    // 3. Re-derive eligibility FRESH — never trust the client's submitted
    //    cohort/eligibility (Phase 1 Gaps: stale recipient list between
    //    preview and send).
    const freshStatuses = await listMemberDuesStatus(fiscalYear);
    const byId = new Map(freshStatuses.map((s) => [s.memberId, s]));
    const { toSend, skipped } = classifyRecipients(
      memberIds,
      freshStatuses.map((s) => ({ memberId: s.memberId, status: s.status, email: s.email })),
    );

    const fromEmail = "treasurer@westervillelions.org";
    const subject = renderDuesReminderSubject(fiscalYear);
    const membersDuesUrl = `${process.env.NEXTAUTH_URL ?? ""}/members/dues`;

    const recipients = toSend.map(({ memberId, cohort }) => {
      const member = byId.get(memberId)!;
      return {
        memberId,
        cohort,
        email: member.email,
        html: renderDuesReminderBody(cohort, {
          firstName: member.firstName,
          fiscalYear,
          individualAmountCents: settings.individualAmountCents,
          familyAmountCents: settings.familyAmountCents,
          membersDuesUrl,
          signerFirstName: treasurer.firstName,
          signerLastName: treasurer.lastName,
          note,
        }),
      };
    });

    // 4. Send. Always via sendBulkMemberEmail() — never a hand-rolled loop
    //    over sendEmail() for this shape (DECISION-085/086). BCC and
    //    Reply-To both go to the office-holder's own address — treasurer@
    //    is a forwarding alias that may retain no copy.
    const { results } = await sendBulkMemberEmail({
      from: fromEmail,
      subject,
      replyTo: treasurer.email,
      bcc: treasurer.email,
      recipients: recipients.map((r) => ({ to: r.email, html: r.html })),
    });
    const resultByEmail = new Map(results.map((r) => [r.to, r]));

    // 5. One dues_reminders row per attempted send — the domain record,
    //    independent of email_queue's own retention.
    const reminderRows: NewDuesReminder[] = recipients.map((r) => {
      const result = resultByEmail.get(r.email);
      return {
        memberId: r.memberId,
        fiscalYear,
        cohort: r.cohort,
        sentByUserId: session.user.id,
        signedAsMemberId: treasurer.memberId,
        emailQueueId: result?.emailQueueId ?? null,
        success: result?.success ?? false,
        error: result?.error ?? null,
        note,
      };
    });
    await insertDuesReminderRows(reminderRows);

    // 6. 200 always — a partial or total send failure is a successful API
    //    call reporting failure, never a 500 (DECISION-075 §6 precedent).
    return NextResponse.json({
      signer: { firstName: treasurer.firstName, lastName: treasurer.lastName },
      sent: recipients.map((r) => {
        const result = resultByEmail.get(r.email);
        return {
          memberId: r.memberId,
          email: r.email,
          cohort: r.cohort,
          success: result?.success ?? false,
          ...(result?.error ? { error: result.error } : {}),
        };
      }),
      skipped,
    });
  } catch (error) {
    console.error("Error sending dues reminders:", error);
    return NextResponse.json({ error: "Failed to send dues reminders" }, { status: 500 });
  }
}
