/**
 * GET   /api/admin/welcome-packets/[id] — full detail for the edit form,
 *   INCLUDING rawHtml. Gate: welcome_packet.manage. 404 if the id doesn't
 *   resolve to an existing packet.
 * PATCH /api/admin/welcome-packets/[id] — edit-in-place (no draft/publish
 *   distinction — see docs/work-log/2026-08-21-welcome-packet-live-page.md,
 *   Phase 3 (Revised) "Edit-in-place vs. fresh-row"). Body:
 *   { lionsYear: string; rawHtml: string }. Gate: welcome_packet.manage.
 *   Same hard-fail validation as POST /api/admin/welcome-packets.
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "API Contract", DECISION-090.
 *
 * Responses: 200 { packet } on GET; 200 { ok: true } on PATCH; 400
 * validation; 401 unauthenticated; 403 forbidden; 404 not found.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getWelcomePacketById, updateWelcomePacket } from "@/lib/welcome-packets-queries";

const RAW_HTML_MAX_LEN = 2_000_000;

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const packet = await getWelcomePacketById(id);
    if (!packet) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ packet });
  } catch (error) {
    console.error("Error fetching welcome packet:", error);
    return NextResponse.json({ error: "Failed to fetch welcome packet" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await getWelcomePacketById(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();

    const lionsYear = body?.lionsYear;
    if (typeof lionsYear !== "string" || !lionsYear.trim()) {
      return NextResponse.json({ error: "lionsYear is required" }, { status: 400 });
    }

    const rawHtml = body?.rawHtml;
    if (typeof rawHtml !== "string" || !rawHtml.trim()) {
      return NextResponse.json({ error: "rawHtml is required" }, { status: 400 });
    }
    if (rawHtml.length > RAW_HTML_MAX_LEN) {
      return NextResponse.json(
        { error: `rawHtml must be ${RAW_HTML_MAX_LEN.toLocaleString()} characters or fewer` },
        { status: 400 },
      );
    }

    const result = await updateWelcomePacket(id, {
      lionsYear: lionsYear.trim(),
      rawHtml,
      updatedByUserId: session.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating welcome packet:", error);
    return NextResponse.json({ error: "Failed to update welcome packet" }, { status: 500 });
  }
}
