/**
 * GET /api/admin/santas-workshop/sessions/[id]/awaiting-pickup.csv
 * Stuffies not yet picked up, with parent contact, for the chair's phone calls. Every
 * cell goes through csvCellSafe() (spreadsheet formula neutralising). Admin only; the
 * crew never gets contact data.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, notFound, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { awaitingPickupCsv } from "@/lib/santas-workshop/awaiting-pickup";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const csv = await awaitingPickupCsv(id);
    if (csv === null) return notFound("Session not found");
    return new Response(csv.body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csv.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return serverError("awaiting pickup csv", e);
  }
}
