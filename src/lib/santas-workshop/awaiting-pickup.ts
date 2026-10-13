/**
 * The "awaiting pickup" CSV (admin only, parent contact included): every
 * non-withdrawn stuffy that is not yet picked up, sorted for phone calls.
 * Every cell goes through csvCellSafe(). Server-only.
 */

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swSessions, swStuffies } from "@/lib/db/schema";
import { csvCellSafe } from "@/lib/csv-safe";
import { displayStuffyName, workerRefundBadge } from "./payment-mapper";

export const AWAITING_PICKUP_HEADER = ["Stuffy", "Parent first name", "Parent last name", "Email", "Phone", "Drop-off window", "State", "Portrait taken", "Refunded"] as const;

export function csvLine(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCellSafe).join(",");
}

export async function awaitingPickupCsv(sessionId: string): Promise<{ filename: string; body: string } | null> {
  const [session] = await db.select().from(swSessions).where(eq(swSessions.id, sessionId)).limit(1);
  if (!session) return null;
  const rows = await db
    .select({
      name: swStuffies.name,
      state: swStuffies.state,
      portraitAt: swStuffies.portraitAt,
      first: swOrders.buyerFirstName,
      last: swOrders.buyerLastName,
      email: swOrders.buyerEmail,
      phone: swOrders.buyerPhone,
      windowId: swOrders.windowId,
      refundStatus: swOrders.refundStatus,
      refundedCents: swOrders.refundedCents,
      paymentDeleted: swOrders.paymentDeleted,
      refundResolutionCents: swOrders.refundResolutionCents,
      orderSize: sql<number>`(select count(*) from sw_stuffies s2 where s2.order_id = ${swStuffies.orderId})::int`,
    })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.sessionId, sessionId), isNull(swStuffies.withdrawnAt), ne(swStuffies.state, "picked_up")))
    .orderBy(asc(sql`lower(coalesce(${swOrders.buyerLastName}, ''))`), asc(swStuffies.name), asc(swStuffies.id));

  const lines = [csvLine([...AWAITING_PICKUP_HEADER])];
  for (const r of rows) {
    lines.push(
      csvLine([
        displayStuffyName(r.name, r.orderSize),
        r.first,
        r.last,
        r.email,
        r.phone,
        session.windows.find((w) => w.id === r.windowId)?.label ?? "",
        r.state,
        r.portraitAt ? "Yes" : "No",
        workerRefundBadge(r) ? "Yes" : "",
      ]),
    );
  }
  return { filename: `awaiting-pickup-${session.slug}.csv`, body: `${lines.join("\r\n")}\r\n` };
}
