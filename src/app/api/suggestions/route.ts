import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { suggestions, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { eq } from "drizzle-orm";

const ALLOWED_CATEGORIES = [
  "Club Activity Idea",
  "Website Improvement",
  "Portal Improvement",
  "Other",
] as const;
type AllowedCategory = (typeof ALLOWED_CATEGORIES)[number];

function isAllowedCategory(value: unknown): value is AllowedCategory {
  return typeof value === "string" && (ALLOWED_CATEGORIES as readonly string[]).includes(value);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { category, message, isAnonymous } = await request.json();

    if (!isAllowedCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (message.length > 5000) {
      return NextResponse.json({ error: "Message is too long" }, { status: 400 });
    }

    const anonymous = isAnonymous === true;

    await db.insert(suggestions).values({
      userId: session.user.id,
      category,
      message: message.trim(),
      isAnonymous: anonymous,
    });

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const safeCategory = esc(category);
    const safeMessage = esc(message.trim()).replace(/\n/g, "<br>");

    let submitterBlock = `<p><strong>From:</strong> Anonymous member</p>`;
    let replyTo: string | undefined;

    if (!anonymous) {
      const [submitter] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1);

      const name = submitter?.name ?? session.user.name ?? "Member";
      const email = submitter?.email ?? session.user.email ?? "";
      replyTo = email || undefined;
      submitterBlock = `
        <p><strong>From:</strong> ${esc(name)}${
          email ? ` &lt;<a href="mailto:${esc(email)}">${esc(email)}</a>&gt;` : ""
        }</p>
      `;
    }

    await sendEmail({
      from: `Westerville Lions Suggestion Box <${fromEmail}>`,
      to: "info@westervillelions.org",
      ...(replyTo && { replyTo }),
      subject: `Suggestion Box: ${category}`,
      html: `
        <h2>New Suggestion Submitted</h2>
        ${submitterBlock}
        <p><strong>Category:</strong> ${safeCategory}</p>
        <hr />
        <p>${safeMessage}</p>
        <hr />
        <p style="color:#666;font-size:13px;">
          This was submitted via the member portal Suggestion Box.
          ${anonymous ? "The submitter chose to remain anonymous." : "Reply directly to respond to the submitter."}
        </p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error submitting suggestion:", error);
    return NextResponse.json(
      { error: "Failed to submit suggestion. Please try again." },
      { status: 500 }
    );
  }
}
