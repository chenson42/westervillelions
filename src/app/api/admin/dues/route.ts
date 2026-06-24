import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { currentFiscalYear } from "@/lib/dues";
import {
  listMemberDuesStatus,
  getDuesSettings,
  listKnownFiscalYears,
} from "@/lib/dues-queries";

/**
 * GET /api/admin/dues?fy=2026&search=&status=
 *
 * Returns member-level dues summary for a fiscal year.
 * Gate: dues.view OR dues.manage
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canView = await hasAnyFeature(session.user.id, [
      FEATURES.DUES_VIEW,
      FEATURES.DUES_MANAGE,
    ]);
    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // Fiscal year: default to current
    const fyParam = searchParams.get("fy");
    const fiscalYear = fyParam ? parseInt(fyParam, 10) : currentFiscalYear(new Date());
    if (isNaN(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      return NextResponse.json({ error: "Invalid fiscal year" }, { status: 400 });
    }

    const search = searchParams.get("search") ?? undefined;
    const statusFilter = searchParams.get("status") ?? undefined; // 'paid' | 'partial' | 'unpaid'

    const [membersData, settings, knownYears] = await Promise.all([
      listMemberDuesStatus(fiscalYear, { search }),
      getDuesSettings(fiscalYear),
      listKnownFiscalYears(),
    ]);

    // Optional status filter (applied in JS after DB fetch — set is small)
    const filtered =
      statusFilter && ["paid", "partial", "unpaid"].includes(statusFilter)
        ? membersData.filter((m) => m.status === statusFilter)
        : membersData;

    return NextResponse.json({
      fiscalYear,
      settings: settings
        ? {
            individualAmountCents: settings.individualAmountCents,
            familyAmountCents: settings.familyAmountCents,
          }
        : null,
      knownFiscalYears: knownYears,
      members: filtered,
    });
  } catch (error) {
    console.error("Error fetching dues list:", error);
    return NextResponse.json({ error: "Failed to fetch dues list" }, { status: 500 });
  }
}
