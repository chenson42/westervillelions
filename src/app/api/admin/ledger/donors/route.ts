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
import { eq } from "drizzle-orm";
import { listDonors } from "@/lib/ledger-queries";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 20;

/**
 * Validates and normalizes a donor `emails` payload.
 * Returns either the normalized (trimmed, lowercased) list, or an error
 * message suitable for a 400 response. Rejects malformed addresses and
 * case-insensitive duplicates within the submitted list (Donor Multiple
 * Emails, 2026-08-08 — "decide what happens on a duplicate within one
 * donor": reject rather than silently dedupe, so the caller always knows
 * exactly what was stored).
 */
function normalizeEmails(input: unknown): { emails: string[] } | { error: string } {
  if (!Array.isArray(input)) {
    return { error: "emails must be an array of strings" };
  }
  if (input.length > MAX_EMAILS) {
    return { error: `emails must contain ${MAX_EMAILS} or fewer addresses` };
  }
  const normalized: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      return { error: "each email must be a string" };
    }
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    if (!EMAIL_REGEX.test(trimmed)) {
      return { error: `"${raw}" is not a valid email address` };
    }
    if (normalized.includes(trimmed)) {
      return { error: `"${trimmed}" is a duplicate within this donor's email list` };
    }
    normalized.push(trimmed);
  }
  return { emails: normalized };
}

/**
 * GET /api/admin/ledger/donors?search=...
 *
 * Returns donors sorted by name ASC.
 * Query params: search (name/email substring, optional — matches any
 * address in the donor's email list)
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

    const donors = await listDonors({ search: search || undefined });

    return NextResponse.json({ donors, total: donors.length });
  } catch (error) {
    console.error("Error listing donors:", error);
    return NextResponse.json({ error: "Failed to list donors" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/donors
 *
 * Body: { name: string, emails?: string[], address?: string, memberId?: string }
 *
 * 409 if a donor with the same name + an overlapping (case-insensitive)
 * email address already exists (soft dedup, generalized from the old
 * single-email exact match).
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
    const { name, emails, address, memberId } = body;

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

    let normalizedEmails: string[] = [];
    if (emails !== undefined && emails !== null) {
      const result = normalizeEmails(emails);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      normalizedEmails = result.emails;
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

    // Soft dedup: 409 if a donor with the same name AND at least one
    // overlapping email address already exists. Generalized from the old
    // single-email exact match — fetched by name (cheap; this table is a
    // handful of rows) and overlap-checked in JS rather than a Postgres
    // array-overlap operator, since it's a one-time check on a tiny table.
    const normalizedName = name.trim();

    if (normalizedEmails.length > 0) {
      const sameName = await db.query.ledgerDonors.findMany({
        where: eq(ledgerDonors.name, normalizedName),
        columns: { id: true, emails: true },
      });
      const existing = sameName.find((d) =>
        d.emails.some((e) => normalizedEmails.includes(e)),
      );
      if (existing) {
        return NextResponse.json(
          {
            error: "A donor with this name and email already exists",
            existingId: existing.id,
          },
          { status: 409 },
        );
      }
    }

    // --- Insert ---
    const [donor] = await db
      .insert(ledgerDonors)
      .values({
        name: normalizedName,
        emails: normalizedEmails,
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
