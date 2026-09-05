import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Returns the active, non-public donation campaigns — the ones /donate's
 * server render omits so the page itself can be statically served. Any
 * signed-in user gets the list (matching the pre-Batch-2 behavior, where
 * /donate's own auth() check gated on session presence alone, not member
 * status); an anonymous request gets an empty array rather than 401, so the
 * client widget can always call this without special-casing the error path.
 * See docs/work-log/2026-09-04-site-review-fixes.md, "Batch 2 — static
 * rendering".
 */
export async function GET() {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json([]);
  }

  const memberOnlyCampaigns = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.isActive, true), eq(campaigns.isPublic, false)))
    .orderBy(campaigns.displayOrder);

  return NextResponse.json(memberOnlyCampaigns);
}
