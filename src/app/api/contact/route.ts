import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contactSubmissions } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { escapeHtml, getFromEmail } from "@/lib/email-compose";
import { getRemoteIp, verifyTurnstile } from "@/lib/turnstile";
import { checkAndRecordFormCooldown, evaluateContentGuard, evaluateStructuralGuard } from "@/lib/form-guard";

export async function POST(request: NextRequest) {
  try {
    const { name, email, message, captchaToken, honeypot, renderedAt } = await request.json();
    const subject = "General Inquiry";

    if (!name || !email || !message) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
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
    // row, no email — so a bot cannot distinguish rejection from acceptance.
    // See docs/work-log/2026-09-28-public-form-spam.md.
    const structuralVerdict = evaluateStructuralGuard({ honeypot, renderedAt });
    if (!structuralVerdict.allow) {
      return NextResponse.json({ success: true });
    }

    // Cooldown is recorded here — after structural passes, BEFORE content is
    // evaluated — so a burst-leading submission whose own content the
    // gibberish check doesn't confidently flag still protects the
    // submissions that follow it in the same email's burst.
    const cooldown = await checkAndRecordFormCooldown(email);
    if (cooldown.withinCooldown) {
      return NextResponse.json({ success: true });
    }

    const contentVerdict = evaluateContentGuard([name, message]);
    if (!contentVerdict.allow) {
      return NextResponse.json({ success: true });
    }

    // Always save to database
    await db.insert(contactSubmissions).values({ name, email, subject, message });

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

    // Admin notification
    await sendEmail({
      from: getFromEmail("Westerville Lions Website"),
      to: "info@westervillelions.org",
      replyTo: email,
      subject: `Website Contact: ${subject}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr />
        <p>${safeMessage}</p>
        <hr />
        <p style="color:#666;font-size:13px;">
          This message was submitted via the contact form at
          <a href="https://westervillelions.org/connect">westervillelions.org/connect</a>.
          To reply, click <strong>Reply</strong> in your email client — replies go directly to ${safeName} at ${safeEmail}.
        </p>
      `,
    });

    // Submitter confirmation
    await sendEmail({
      from: getFromEmail("Westerville Lions Club"),
      to: email,
      subject: "We received your message!",
      html: `
        <p>Hi ${safeName},</p>
        <p>Thank you for reaching out to the Westerville Lions Club. We've received your message and a member of our team will be in touch with you soon.</p>
        <p>In the meantime, feel free to visit our website at <a href="https://westervillelions.org">westervillelions.org</a> to learn more about our community and upcoming events.</p>
        <br />
        <p>Yours in service,</p>
        <p><strong>Westerville Lions Club</strong></p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error processing contact form:", error);
    return NextResponse.json(
      { error: "Failed to send message. Please try again." },
      { status: 500 }
    );
  }
}
