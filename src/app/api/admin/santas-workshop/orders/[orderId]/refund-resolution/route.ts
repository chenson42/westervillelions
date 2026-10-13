/**
 * POST /api/admin/santas-workshop/orders/[orderId]/refund-resolution  { resolution: "keep" | "withdraw" }  -> RefundResolutionResponse
 *
 * keep: stores the refunded amount seen, so the flag clears and a later, larger refund
 * reopens it by itself. withdraw: withdraws every stuffy of the order still in
 * registered/tagged; stuffies already in custody stay flagged and the flag stays open
 * for them. Neither ever blocks a hand-over.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { loadOrderSession, resolveRefund } from "@/lib/santas-workshop/stuffy-admin";

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { orderId } = await params;
  if (!isUuid(orderId)) return notFound("Order not found");
  try {
    const body = (await readJson(request)) as { resolution?: unknown } | null;
    if (body?.resolution !== "keep" && body?.resolution !== "withdraw") return adminError(400, "invalid_input", "Choose keep or withdraw", "resolution");
    const owner = await loadOrderSession(orderId);
    if (!owner) return notFound("Order not found");
    const result = await resolveRefund(owner, orderId, body.resolution, session.user.id);
    return result.ok ? ok(result.result) : fromFailure(result);
  } catch (e) {
    return serverError("refund resolution", e);
  }
}
