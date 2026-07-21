import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";

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

    const {
      firstName,
      lastName,
      email,
      captchaToken,
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

    const captchaValid = await verifyTurnstile(captchaToken);
    if (!captchaValid) {
      return NextResponse.json({ error: "CAPTCHA verification failed. Please try again." }, { status: 400 });
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
        const esc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
        await sendEmail({
          from: `Westerville Lions Portal <${fromEmail}>`,
          to: "info@westervillelions.org",
          subject: "New membership application received",
          html: `
            <h2>New Membership Application</h2>
            <p><strong>Name:</strong> ${esc(firstName)} ${esc(lastName)}</p>
            <p><strong>Email:</strong> ${esc(email)}</p>
            <p><strong>Phone:</strong> ${esc(phone || "(not provided)")}</p>
            <p><strong>Member Type:</strong> ${esc(memberType || "new")}</p>
            <p><strong>Submitted:</strong> ${esc(new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }))}</p>
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
