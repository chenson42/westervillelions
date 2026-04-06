import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { contactSubmissions } from "@/lib/db/schema";

async function verifyTurnstile(token: string): Promise<boolean> {
  // Use test secret if no real one is configured
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
    const { name, email, message, captchaToken } = await request.json();
    const subject = "General Inquiry";

    if (!name || !email || !message) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    if (!captchaToken) {
      return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
    }

    const captchaValid = await verifyTurnstile(captchaToken);
    if (!captchaValid) {
      return NextResponse.json({ error: "CAPTCHA verification failed. Please try again." }, { status: 400 });
    }

    // Always save to database
    await db.insert(contactSubmissions).values({ name, email, subject, message });

    if (!process.env.RESEND_API_KEY) {
      console.log(`[Contact Form] From: ${name} <${email}>, Subject: ${subject}\n${message}`);
      return NextResponse.json({ success: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";

    await resend.emails.send({
      from: `Westerville Lions Website <${fromEmail}>`,
      to: ["info@westervillelions.org"],
      replyTo: email,
      subject: `Website Contact: ${subject}`,
      html: `
        <h2>Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr />
        <p>${message.replace(/\n/g, "<br>")}</p>
      `,
    });

    await resend.emails.send({
      from: `Westerville Lions Club <${fromEmail}>`,
      to: [email],
      subject: "We received your message!",
      html: `
        <p>Hi ${name},</p>
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
