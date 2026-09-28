import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { escapeHtml, getFromEmail } from "@/lib/email-compose";
import { getRemoteIp, verifyTurnstile } from "@/lib/turnstile";
import { checkAndRecordFormCooldown, evaluateContentGuard, evaluateStructuralGuard } from "@/lib/form-guard";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      firstName,
      lastName,
      email,
      captchaToken,
      honeypot,
      renderedAt,
      middleInitial,
      suffix,
      gender,
      occupation,
      dateOfBirth,
      spouseName,
      address,
      city,
      state,
      zip,
      phone,
      memberType,
      sponsorName,
      previousMemberNumber,
      previousClubName,
      previousClubNumber,
    } = body;

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: "First name, last name, and email are required" },
        { status: 400 }
      );
    }

    if (!captchaToken) {
      return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
    }

    const captcha = await verifyTurnstile(captchaToken, { remoteip: getRemoteIp(request) });
    if (!captcha.success) {
      return NextResponse.json({ error: "CAPTCHA verification failed. Please try again." }, { status: 400 });
    }

    // Anti-bot, per DECISION-104 (Revision 2): structural guard (honeypot +
    // timing) → cooldown check-and-record (unconditional on content) →
    // content guard (two-field gibberish agreement). Every rejection here is
    // silent — same { success: true } response as a real submission, no DB
    // row, no email. See docs/work-log/2026-09-28-public-form-spam.md.
    const structuralVerdict = evaluateStructuralGuard({ honeypot, renderedAt });
    if (!structuralVerdict.allow) {
      return NextResponse.json({ success: true });
    }

    // Cooldown is recorded here — after structural passes, BEFORE content is
    // evaluated — so a burst-leading submission whose own content the
    // gibberish check doesn't confidently flag still protects the
    // submissions that follow it in the same email's burst. (Membership is
    // usually the burst LEADER in the observed incident, so this particular
    // route benefits least from the reorder — see DECISION-104's documented
    // residual gap — but the check still runs here for consistency and for
    // the cases where membership isn't the leader.)
    const cooldown = await checkAndRecordFormCooldown(email);
    if (cooldown.withinCooldown) {
      return NextResponse.json({ success: true });
    }

    const contentVerdict = evaluateContentGuard([firstName, lastName, city]);
    if (!contentVerdict.allow) {
      return NextResponse.json({ success: true });
    }

    await db.insert(membershipApplications).values({
      firstName,
      lastName,
      email,
      middleInitial: middleInitial || null,
      suffix: suffix || null,
      gender: gender || null,
      occupation: occupation || null,
      dateOfBirth: dateOfBirth || null,
      spouseName: spouseName || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      phone: phone || null,
      memberType: memberType || "new",
      sponsorName: sponsorName || null,
      previousMemberNumber: previousMemberNumber || null,
      previousClubName: previousClubName || null,
      previousClubNumber: previousClubNumber || null,
    });

    after(async () => {
      try {
        await sendEmail({
          from: getFromEmail("Westerville Lions Portal"),
          to: "info@westervillelions.org",
          subject: "New membership application received",
          html: `
            <h2>New Membership Application</h2>
            <p><strong>Name:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(phone || "(not provided)")}</p>
            <p><strong>Member Type:</strong> ${escapeHtml(memberType || "new")}</p>
            <p><strong>Submitted:</strong> ${escapeHtml(new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }))}</p>
            <p>Review this application in <a href="https://westervillelions.org/admin/membership">Admin &rarr; Membership</a>.</p>
          `,
        });
      } catch {
        // Swallow — background email task must not throw, and must never affect
        // a response that has already been sent to the applicant.
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error submitting membership application:", error);
    return NextResponse.json(
      { error: "Failed to submit application. Please try again." },
      { status: 500 }
    );
  }
}
