import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { newsletterSubscriptions } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY ?? "1x0000000000000000000000000000000AA";
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token }),
  });
  const data = await res.json();
  return data.success === true;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, firstName, lastName, captchaToken } = body;

    if (!captchaToken) {
      return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
    }

    const captchaValid = await verifyTurnstile(captchaToken);
    if (!captchaValid) {
      return NextResponse.json({ error: "CAPTCHA verification failed. Please try again." }, { status: 400 });
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
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
