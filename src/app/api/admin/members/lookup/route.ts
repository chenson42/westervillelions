import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import { FEATURES } from "@/lib/permissions";
import { sql } from "drizzle-orm";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GET /api/admin/members/lookup?email=...
 *
 * Narrow point-lookup: given an email address, find the matching member or user
 * and return minimal { id, name, email } for use by the write-in form's "Add as
 * Member" CTA.
 *
 * Auth: requires EVENTS_EDIT (not MEMBERS_VIEW — response is minimal PII).
 *
 * Responses:
 *   200  { id: string; name: string; email: string } — match found (id is users.id)
 *   200  null — no match
 *   400  missing or invalid email
 *   401  not authenticated
 *   403  forbidden
 *   500  server error
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!session.user.features?.includes(FEATURES.EVENTS_EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "email query param is required" }, { status: 400 });
    }

    const trimmed = email.trim();
    if (!EMAIL_REGEX.test(trimmed)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const lower = trimmed.toLowerCase();

    // Search members table first (canonical source)
    const memberMatch = await db.query.members.findFirst({
      where: sql`lower(${members.email}) = ${lower}`,
    });

    if (memberMatch) {
      // Resolve to the linked users.id if available
      const userMatch = await db.query.users.findFirst({
        where: sql`lower(${users.email}) = ${lower}`,
      });
      if (userMatch) {
        return NextResponse.json({
          id: userMatch.id,
          name: `${memberMatch.firstName} ${memberMatch.lastName}`.trim(),
          email: memberMatch.email,
        });
      }
      // Member exists but no user account — return member id as fallback
      // (write-in form CTA will call member-add POST which may create the account)
      return NextResponse.json({
        id: memberMatch.id,
        name: `${memberMatch.firstName} ${memberMatch.lastName}`.trim(),
        email: memberMatch.email,
      });
    }

    // Fall back to users table (user without member row — e.g., invited but not yet a full member)
    const userMatch = await db.query.users.findFirst({
      where: sql`lower(${users.email}) = ${lower}`,
    });

    if (userMatch) {
      return NextResponse.json({
        id: userMatch.id,
        name: userMatch.name ?? trimmed,
        email: userMatch.email,
      });
    }

    // No match
    return NextResponse.json(null);
  } catch (error) {
    console.error("Error in member lookup:", error);
    return NextResponse.json({ error: "Failed to lookup member" }, { status: 500 });
  }
}
