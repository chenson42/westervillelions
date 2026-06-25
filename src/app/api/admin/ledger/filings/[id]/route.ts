/**
 * PATCH /api/admin/ledger/filings/[id]  (status update — mark in_progress or filed)
 * Gate: LEDGER_RECORD
 *
 * Body:
 * {
 *   status: 'in_progress' | 'filed';
 *   filedOn?: string;       // ISO date YYYY-MM-DD; required when status='filed'
 *   confirmation?: string;  // max 100 chars; optional
 *   note?: string;          // max 1000 chars; optional
 * }
 *
 * Response 200: { filing: LedgerFiling }
 * Response 400: validation error
 * Response 401: not authenticated
 * Response 403: lacks LEDGER_RECORD
 * Response 404: filing not found
 * Response 500: server error
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PATCH /api/admin/ledger/filings/[id]  (metadata edit — agency/title/dueMonth/dueDay/recurrence/note)
 * Gate: LEDGER_MANAGE (distinguished by presence of metadata fields in body)
 *
 * Both operations use PATCH on the same route. The route checks:
 *   - If body contains status: gate is LEDGER_RECORD
 *   - If body contains agency/title/dueMonth/dueDay/recurrence: gate is LEDGER_MANAGE
 *   - Mixing both in one request is not supported (400)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELETE /api/admin/ledger/filings/[id]
 * Gate: LEDGER_MANAGE
 *
 * Guard: returns 409 if filing.status === 'filed' — filed rows cannot be deleted.
 * Response 204: deleted
 * Response 404: not found
 * Response 409: cannot delete a filed filing
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerFilings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !DATE_REGEX.test(raw)) return null;
  const d = new Date(raw + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return raw;
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/ledger/filings/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    // Determine operation type by presence of discriminating fields
    const isStatusUpdate =
      body.status !== undefined ||
      body.filedOn !== undefined ||
      body.confirmation !== undefined;
    const isMetadataEdit =
      body.agency !== undefined ||
      body.title !== undefined ||
      body.dueMonth !== undefined ||
      body.dueDay !== undefined ||
      body.recurrence !== undefined;

    if (isStatusUpdate && isMetadataEdit) {
      return NextResponse.json(
        { error: "Cannot mix status-update and metadata-edit fields in the same request" },
        { status: 400 },
      );
    }

    if (!isStatusUpdate && !isMetadataEdit && body.note === undefined) {
      return NextResponse.json(
        { error: "No updatable fields provided" },
        { status: 400 },
      );
    }

    // -----------------------------------------------------------------------
    // Status update path (LEDGER_RECORD)
    // -----------------------------------------------------------------------
    if (isStatusUpdate || (!isMetadataEdit && body.note !== undefined && body.status !== undefined)) {
      if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Fetch the filing row
      const existing = await db
        .select()
        .from(ledgerFilings)
        .where(eq(ledgerFilings.id, id))
        .limit(1);
      if (!existing[0]) {
        return NextResponse.json({ error: "Filing not found" }, { status: 404 });
      }

      // Validate status
      if (body.status !== undefined) {
        if (body.status !== "in_progress" && body.status !== "filed") {
          return NextResponse.json(
            { error: "status must be 'in_progress' or 'filed'" },
            { status: 400 },
          );
        }
      }

      // When status='filed', filedOn is required
      let filedOn: string | null = existing[0].filedOn ?? null;
      if (body.status === "filed") {
        if (body.filedOn === undefined || body.filedOn === null) {
          return NextResponse.json(
            { error: "filedOn is required when status is 'filed'" },
            { status: 400 },
          );
        }
        const parsed = parseIsoDate(body.filedOn);
        if (!parsed) {
          return NextResponse.json(
            { error: "filedOn must be a valid date in YYYY-MM-DD format" },
            { status: 400 },
          );
        }
        filedOn = parsed;
      } else if (body.filedOn !== undefined) {
        // filedOn provided but not filing — validate and accept (allows in_progress with partial date)
        if (body.filedOn !== null) {
          const parsed = parseIsoDate(body.filedOn);
          if (!parsed) {
            return NextResponse.json(
              { error: "filedOn must be a valid date in YYYY-MM-DD format or null" },
              { status: 400 },
            );
          }
          filedOn = parsed;
        } else {
          filedOn = null;
        }
      }

      // Validate confirmation (max 100 chars)
      let confirmation: string | null = existing[0].confirmation ?? null;
      if (body.confirmation !== undefined) {
        if (body.confirmation !== null) {
          if (typeof body.confirmation !== "string") {
            return NextResponse.json(
              { error: "confirmation must be a string or null" },
              { status: 400 },
            );
          }
          if (body.confirmation.length > 100) {
            return NextResponse.json(
              { error: "confirmation must not exceed 100 characters" },
              { status: 400 },
            );
          }
          confirmation = body.confirmation;
        } else {
          confirmation = null;
        }
      }

      // Validate note (max 1000 chars)
      let note: string | null = existing[0].note ?? null;
      if (body.note !== undefined) {
        if (body.note !== null) {
          if (typeof body.note !== "string") {
            return NextResponse.json(
              { error: "note must be a string or null" },
              { status: 400 },
            );
          }
          if (body.note.length > 1000) {
            return NextResponse.json(
              { error: "note must not exceed 1000 characters" },
              { status: 400 },
            );
          }
          note = body.note;
        } else {
          note = null;
        }
      }

      const updatePayload: Partial<typeof ledgerFilings.$inferInsert> & { updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (body.status !== undefined) updatePayload.status = body.status;
      if (filedOn !== (existing[0].filedOn ?? null)) updatePayload.filedOn = filedOn;
      if (confirmation !== (existing[0].confirmation ?? null))
        updatePayload.confirmation = confirmation;
      if (note !== (existing[0].note ?? null)) updatePayload.note = note;

      const updated = await db
        .update(ledgerFilings)
        .set(updatePayload)
        .where(eq(ledgerFilings.id, id))
        .returning();

      return NextResponse.json({ filing: updated[0] });
    }

    // -----------------------------------------------------------------------
    // Metadata edit path (LEDGER_MANAGE)
    // -----------------------------------------------------------------------
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch the filing row
    const existing = await db
      .select()
      .from(ledgerFilings)
      .where(eq(ledgerFilings.id, id))
      .limit(1);
    if (!existing[0]) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 });
    }

    type MetaPayload = Partial<typeof ledgerFilings.$inferInsert> & { updatedAt: Date };
    const metaUpdate: MetaPayload = { updatedAt: new Date() };

    if (body.agency !== undefined) {
      if (typeof body.agency !== "string" || body.agency.trim() === "") {
        return NextResponse.json({ error: "agency must be a non-empty string" }, { status: 400 });
      }
      if (body.agency.length > 100) {
        return NextResponse.json(
          { error: "agency must not exceed 100 characters" },
          { status: 400 },
        );
      }
      metaUpdate.agency = body.agency.trim();
    }

    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.trim() === "") {
        return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
      }
      if (body.title.length > 200) {
        return NextResponse.json(
          { error: "title must not exceed 200 characters" },
          { status: 400 },
        );
      }
      metaUpdate.title = body.title.trim();
    }

    if (body.dueMonth !== undefined) {
      if (
        typeof body.dueMonth !== "number" ||
        !Number.isInteger(body.dueMonth) ||
        body.dueMonth < 1 ||
        body.dueMonth > 12
      ) {
        return NextResponse.json(
          { error: "dueMonth must be an integer between 1 and 12" },
          { status: 400 },
        );
      }
      metaUpdate.dueMonth = body.dueMonth;
    }

    if (body.dueDay !== undefined) {
      if (
        typeof body.dueDay !== "number" ||
        !Number.isInteger(body.dueDay) ||
        body.dueDay < 1 ||
        body.dueDay > 31
      ) {
        return NextResponse.json(
          { error: "dueDay must be an integer between 1 and 31" },
          { status: 400 },
        );
      }
      metaUpdate.dueDay = body.dueDay;
    }

    if (body.recurrence !== undefined) {
      if (body.recurrence !== "annual" && body.recurrence !== "5_year") {
        return NextResponse.json(
          { error: "recurrence must be 'annual' or '5_year'" },
          { status: 400 },
        );
      }
      metaUpdate.recurrence = body.recurrence;
    }

    if (body.note !== undefined) {
      if (body.note !== null) {
        if (typeof body.note !== "string") {
          return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
        }
        if (body.note.length > 1000) {
          return NextResponse.json(
            { error: "note must not exceed 1000 characters" },
            { status: 400 },
          );
        }
        metaUpdate.note = body.note;
      } else {
        metaUpdate.note = null;
      }
    }

    const updated = await db
      .update(ledgerFilings)
      .set(metaUpdate)
      .where(eq(ledgerFilings.id, id))
      .returning();

    return NextResponse.json({ filing: updated[0] });
  } catch (error) {
    console.error("Error updating ledger filing:", error);
    return NextResponse.json({ error: "Failed to update filing" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/ledger/filings/[id]
// ---------------------------------------------------------------------------

export async function DELETE(
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

    const existing = await db
      .select({ id: ledgerFilings.id, status: ledgerFilings.status })
      .from(ledgerFilings)
      .where(eq(ledgerFilings.id, id))
      .limit(1);

    if (!existing[0]) {
      return NextResponse.json({ error: "Filing not found" }, { status: 404 });
    }

    // Guard: cannot delete a filed row
    if (existing[0].status === "filed") {
      return NextResponse.json(
        { error: "Cannot delete a filed filing. Mark as N/A instead." },
        { status: 409 },
      );
    }

    await db.delete(ledgerFilings).where(eq(ledgerFilings.id, id));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error deleting ledger filing:", error);
    return NextResponse.json({ error: "Failed to delete filing" }, { status: 500 });
  }
}
