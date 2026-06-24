import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { currentFiscalYear } from "@/lib/dues";
import { getMemberDuesForUser, listKnownFiscalYears } from "@/lib/dues-queries";

/**
 * GET /api/members/dues?fy=2026
 *
 * Returns the authenticated member's own dues status and payment history for
 * a fiscal year.
 *
 * Gate: signed-in session with session.user.memberId non-null.
 *
 * Ownership enforcement:
 * - We only use session.user.memberId (set by the JWT callback from users.memberId).
 * - There is NO memberId in the request URL or query params — the caller cannot
 *   request data for a different member. getMemberDuesForUser accepts the
 *   caller's own memberId, fetched exclusively from the session.
 * - recordedByUserId is omitted from payment rows by getMemberDuesForUser.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Member linkage check — users.memberId is null when the user account has
    // no linked member record (e.g., a volunteer-only account).
    const memberId = session.user.memberId;
    if (!memberId) {
      return NextResponse.json(
        { error: "No member record linked to your account" },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(request.url);
    const fyParam = searchParams.get("fy");
    const fiscalYear = fyParam
      ? parseInt(fyParam, 10)
      : currentFiscalYear(new Date());

    if (isNaN(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "Invalid fiscal year" }, { status: 400 });
    }

    const [data, knownYears] = await Promise.all([
      getMemberDuesForUser(memberId, fiscalYear),
      listKnownFiscalYears(),
    ]);

    if (!data) {
      return NextResponse.json(
        { error: "Member record not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      fiscalYear,
      knownFiscalYears: knownYears,
      ...data,
    });
  } catch (error) {
    console.error("Error fetching member dues:", error);
    return NextResponse.json(
      { error: "Failed to fetch dues information" },
      { status: 500 },
    );
  }
}
