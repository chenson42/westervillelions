/**
 * GET  /api/admin/ledger/donors   — List donors (search optional)
 * POST /api/admin/ledger/donors   — Create a donor
 *
 * Both gates: LEDGER_RECORD (donor PII is restricted to treasurer/admin).
 * 403 (not 404) on missing feature to prevent enumeration.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import { ledgerDonors, members } from "@/lib/db/schema";
import { and, eq, ilike, or, asc } from "drizzle-orm";

/**
 * GET /api/admin/ledger/donors?search=...
 *
 * Returns donors sorted by name ASC.
 * Query params: search (name/email substring, optional)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();

    let donors;
    if (search && search.length > 0) {
      const term = `%${search}%`;
      donors = await db
        .select()
        .from(ledgerDonors)
        .where(or(ilike(ledgerDonors.name, term), ilike(ledgerDonors.email, term)))
        .orderBy(asc(ledgerDonors.name));
    } else {
      donors = await db.select().from(ledgerDonors).orderBy(asc(ledgerDonors.name));
    }

    return NextResponse.json({ donors, total: donors.length });
  } catch (error) {
    console.error("Error listing donors:", error);
    return NextResponse.json({ error: "Failed to list donors" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/donors
 *
 * Body: { name: string, email?: string, address?: string, memberId?: string }
 *
 * 409 if a donor with the same name + non-null email already exists (soft dedup).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, email, address, memberId } = body;

    // --- Validate ---
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (name.trim().length > 200) {
      return NextResponse.json(
        { error: "name must be 200 characters or fewer" },
        { status: 400 },
      );
    }

    if (email !== undefined && email !== null) {
      if (typeof email !== "string") {
        return NextResponse.json({ error: "email must be a string" }, { status: 400 });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return NextResponse.json({ error: "email must be a valid email address" }, { status: 400 });
      }
    }

    if (address !== undefined && address !== null) {
      if (typeof address !== "string") {
        return NextResponse.json({ error: "address must be a string" }, { status: 400 });
      }
      if (address.length > 500) {
        return NextResponse.json(
          { error: "address must be 500 characters or fewer" },
          { status: 400 },
        );
      }
    }

    if (memberId !== undefined && memberId !== null) {
      if (typeof memberId !== "string") {
        return NextResponse.json({ error: "memberId must be a string" }, { status: 400 });
      }
      const member = await db.query.members.findFirst({
        where: eq(members.id, memberId),
        columns: { id: true },
      });
      if (!member) {
        return NextResponse.json({ error: "Member not found" }, { status: 400 });
      }
    }

    // Soft dedup: 409 if same name + same non-null email already exists
    const normalizedName = name.trim();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : null;

    if (normalizedEmail) {
      const existing = await db.query.ledgerDonors.findFirst({
        where: and(
          eq(ledgerDonors.name, normalizedName),
          eq(ledgerDonors.email, normalizedEmail),
        ),
        columns: { id: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: "A donor with this name and email already exists", existingId: existing.id },
          { status: 409 },
        );
      }
    }

    // --- Insert ---
    const [donor] = await db
      .insert(ledgerDonors)
      .values({
        name: normalizedName,
        email: normalizedEmail ?? null,
        address: typeof address === "string" ? address.trim() : null,
        memberId: memberId ?? null,
      })
      .returning();

    return NextResponse.json(donor, { status: 201 });
  } catch (error) {
    console.error("Error creating donor:", error);
    return NextResponse.json({ error: "Failed to create donor" }, { status: 500 });
  }
}
