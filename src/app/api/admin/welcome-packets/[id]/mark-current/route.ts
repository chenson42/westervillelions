/**
 * POST /api/admin/welcome-packets/[id]/mark-current — the publish action.
 * No request body. Gate: welcome_packet.manage. 404 if the id doesn't
 * resolve to an existing packet.
 *
 * Flips the welcome_packet_current singleton pointer to this packet, inside
 * one DB transaction (src/lib/welcome-packets-queries.ts's
 * markWelcomePacketCurrent()) — structurally race-free, since the pointer
 * column can only ever hold one value at a time (Phase 2 (Revised) §1 /
 * DECISION-090).
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "API Contract" (mirrors /api/admin/minutes/[id]/restore's "dedicated
 * action route, no body" shape).
 *
 * Responses: 200 { ok: true } success; 401 unauthenticated; 403 forbidden;
 * 404 not found.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { markWelcomePacketCurrent } from "@/lib/welcome-packets-queries";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const result = await markWelcomePacketCurrent(id, session.user.id);

    if (!result.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error marking welcome packet current:", error);
    return NextResponse.json({ error: "Failed to mark welcome packet current" }, { status: 500 });
  }
}
