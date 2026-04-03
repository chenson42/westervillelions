import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { membershipApplications } from "@/lib/db/schema";

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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error submitting membership application:", error);
    return NextResponse.json(
      { error: "Failed to submit application. Please try again." },
      { status: 500 }
    );
  }
}
