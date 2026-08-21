/**
 * GET  /api/admin/welcome-packets — admin list (summary rows only — never
 *   rawHtml, which can be ~375KB per row; the list view never needs the
 *   body). Gate: welcome_packet.manage.
 * POST /api/admin/welcome-packets — create a new packet row. Body:
 *   { lionsYear: string; rawHtml: string }. Gate: welcome_packet.manage.
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "API Contract", DECISION-090.
 *
 * Validation on POST: lionsYear must match /^\d{4}-\d{2}$/
 * (isValidLionsYear()), and extractPacketParts(rawHtml) must succeed (all
 * three anchors — <title>, <style>, <div class="deck"> — found) BEFORE the
 * row is written (hard-fail save-time validation — Phase 3 (Revised)
 * design decision 2). A parse failure returns 400 with
 * extractPacketParts()'s own specific missing-anchor message verbatim, not
 * a generic "save failed."
 *
 * Responses: 201 { id } on create; 200 { packets: WelcomePacketListItem[] }
 * on list; 400 validation; 401 unauthenticated; 403 forbidden.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { createWelcomePacket, listWelcomePackets } from "@/lib/welcome-packets-queries";

// Generous ceiling, not a real content limit — the real packet is ~375KB
// (it embeds a base64 emblem image); this just catches a fat-fingered or
// garbage payload rather than constraining legitimate content.
const RAW_HTML_MAX_LEN = 2_000_000;

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const packets = await listWelcomePackets();
    return NextResponse.json({ packets });
  } catch (error) {
    console.error("Error listing welcome packets:", error);
    return NextResponse.json({ error: "Failed to list welcome packets" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    const result = await createWelcomePacket({
      lionsYear: lionsYear.trim(),
      rawHtml,
      createdByUserId: session.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Error creating welcome packet:", error);
    return NextResponse.json({ error: "Failed to create welcome packet" }, { status: 500 });
  }
}
