import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newsletterSubscriptions } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";
import { getRemoteIp, verifyTurnstile } from "@/lib/turnstile";
import { checkAndRecordFormCooldown, evaluateContentGuard, evaluateStructuralGuard } from "@/lib/form-guard";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, firstName, lastName, captchaToken, honeypot, renderedAt } = body;

    if (!captchaToken) {
      return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
    }

    const captcha = await verifyTurnstile(captchaToken, { remoteip: getRemoteIp(request) });
    if (!captcha.success) {
      return NextResponse.json({ error: "CAPTCHA verification failed. Please try again." }, { status: 400 });
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Anti-bot, per DECISION-104 (Revision 2): structural guard (honeypot +
    // timing) → cooldown check-and-record (unconditional on content) →
    // content guard (two-field gibberish agreement). Every rejection here is
    // silent — same { success: true } response as a real subscription, no DB
    // row. See docs/work-log/2026-09-28-public-form-spam.md.
    const structuralVerdict = evaluateStructuralGuard({ honeypot, renderedAt });
    if (!structuralVerdict.allow) {
      return NextResponse.json({ success: true });
    }

    // Cooldown is recorded here — after structural passes, BEFORE content is
    // evaluated — so a burst-leading submission whose own content the
    // gibberish check doesn't confidently flag still protects the
    // submissions that follow it in the same email's burst.
    const cooldown = await checkAndRecordFormCooldown(trimmedEmail);
    if (cooldown.withinCooldown) {
      return NextResponse.json({ success: true });
    }

    const contentVerdict = evaluateContentGuard([firstName, lastName]);
    if (!contentVerdict.allow) {
      return NextResponse.json({ success: true });
    }

    // Check if already exists
    const existing = await db
      .select({ id: newsletterSubscriptions.id })
      .from(newsletterSubscriptions)
      .where(sql`lower(${newsletterSubscriptions.email}) = ${trimmedEmail}`)
      .limit(1);

    if (existing.length > 0) {
      // Re-activate if unsubscribed
      await db
        .update(newsletterSubscriptions)
        .set({ isActive: true, unsubscribedAt: null, updatedAt: sql`NOW()` })
        .where(eq(newsletterSubscriptions.id, existing[0].id));
    } else {
      await db.insert(newsletterSubscriptions).values({
        email: trimmedEmail,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        isActive: true,
        source: "contact-page",
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
