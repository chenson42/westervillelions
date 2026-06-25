/**
 * POST /api/admin/ledger/filings
 * Gate: LEDGER_MANAGE
 *
 * Adds a one-off filing row to the calendar for a specific entity + fiscal year.
 *
 * Body:
 * {
 *   entityId: string;        // UUID
 *   fiscalYear: number;      // integer FY start year
 *   agency: string;          // max 100 chars
 *   title: string;           // max 200 chars
 *   dueMonth: number;        // 1–12
 *   dueDay: number;          // 1–31
 *   recurrence: 'annual' | '5_year';
 *   note?: string;           // max 1000 chars
 * }
 *
 * Response 201: { filing: LedgerFiling }
 * Response 400: validation error
 * Response 401: not authenticated
 * Response 403: lacks LEDGER_MANAGE
 * Response 409: unique constraint conflict (same entity/fy/agency/title)
 * Response 500: server error
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerFilings, ledgerEntities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// POST /api/admin/ledger/filings
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    // Validate required fields
    if (!body.entityId || typeof body.entityId !== "string") {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }
    if (
      body.fiscalYear === undefined ||
      typeof body.fiscalYear !== "number" ||
      !Number.isInteger(body.fiscalYear) ||
      body.fiscalYear < 2000 ||
      body.fiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }
    if (!body.agency || typeof body.agency !== "string" || body.agency.trim() === "") {
      return NextResponse.json({ error: "agency is required" }, { status: 400 });
    }
    if (body.agency.length > 100) {
      return NextResponse.json(
        { error: "agency must not exceed 100 characters" },
        { status: 400 },
      );
    }
    if (!body.title || typeof body.title !== "string" || body.title.trim() === "") {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (body.title.length > 200) {
      return NextResponse.json(
        { error: "title must not exceed 200 characters" },
        { status: 400 },
      );
    }
    if (
      body.dueMonth === undefined ||
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
    if (
      body.dueDay === undefined ||
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
    if (body.recurrence !== "annual" && body.recurrence !== "5_year") {
      return NextResponse.json(
        { error: "recurrence must be 'annual' or '5_year'" },
        { status: 400 },
      );
    }
    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== "string") {
        return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
      }
      if (body.note.length > 1000) {
        return NextResponse.json(
          { error: "note must not exceed 1000 characters" },
          { status: 400 },
        );
      }
    }

    // Verify the entity exists
    const entityRows = await db
      .select({ id: ledgerEntities.id })
      .from(ledgerEntities)
      .where(eq(ledgerEntities.id, body.entityId))
      .limit(1);
    if (!entityRows[0]) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Insert the new filing row
    try {
      const inserted = await db
        .insert(ledgerFilings)
        .values({
          entityId: body.entityId,
          fiscalYear: body.fiscalYear,
          agency: body.agency.trim(),
          title: body.title.trim(),
          dueMonth: body.dueMonth,
          dueDay: body.dueDay,
          recurrence: body.recurrence,
          note: body.note ?? null,
          status: "not_started",
        })
        .returning();

      return NextResponse.json({ filing: inserted[0] }, { status: 201 });
    } catch (err: unknown) {
      // Unique constraint violation.
      // Drizzle may wrap the raw PostgresError (which carries .code) inside a
      // new Error with the original as .cause, so we check both levels.
      const pgCode =
        (typeof err === "object" && err !== null && "code" in err
          ? (err as { code?: string }).code
          : undefined) ??
        (typeof err === "object" &&
        err !== null &&
        "cause" in err &&
        typeof (err as { cause?: unknown }).cause === "object" &&
        (err as { cause?: unknown }).cause !== null &&
        "code" in ((err as { cause: object }).cause)
          ? ((err as { cause: { code?: string } }).cause.code)
          : undefined);
      if (pgCode === "23505") {
        return NextResponse.json(
          { error: "A filing with this agency and title already exists for this entity and fiscal year." },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("Error creating ledger filing:", error);
    return NextResponse.json({ error: "Failed to create filing" }, { status: 500 });
  }
}
