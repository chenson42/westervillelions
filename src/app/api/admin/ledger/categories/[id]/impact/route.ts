/**
 * GET /api/admin/ledger/categories/[id]/impact
 *
 * Ledger Category Management (2026-08-07 / DECISION-065/066) — one response
 * shape, three callers: the rename dialog's "what this affects" preview, the
 * countsAsGiving flip's dollar-impact display, and the deactivate confirm's
 * open-balance warning. Backed by getCategoryImpact() (ledger-category-
 * queries.ts), which reuses getPhilanthropy's exact filter
 * (ledger-queries.ts:4705-4712) for postedGivingCents so this warning can
 * never drift from what /members/impact actually shows.
 *
 * Gate: LEDGER_MANAGE
 *
 * No body. Response 200: CategoryImpact (see ledger-category-queries.ts).
 * Errors: 401; 403; 404 category not found.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getCategoryImpact } from "@/lib/ledger-category-queries";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const impact = await getCategoryImpact(id);
    if (!impact) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json(impact);
  } catch (error) {
    console.error("Error fetching ledger category impact:", error);
    return NextResponse.json({ error: "Failed to fetch category impact" }, { status: 500 });
  }
}
