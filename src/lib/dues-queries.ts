/**
 * Server-only dues query helpers.
 *
 * These functions are the authoritative data-access layer for the dues feature.
 * Import them in server components and API route handlers — never in client components.
 *
 * Member ↔ user linkage: users.memberId (FK → members.id).
 * The JWT callback in src/lib/auth/index.ts puts token.memberId into the session,
 * so session.user.memberId is the caller's own member ID. Absence means unlinked.
 */

import { db } from "@/lib/db";
import { members, duesPayments, duesSettings } from "@/lib/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import { deriveStatus, currentFiscalYear, type DuesStatus } from "@/lib/dues";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type MemberDuesSummary = {
  memberId: string;
  memberNumber: number | null;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  duesCategory: string;
  totalPaidCents: number;
  expectedAmountCents: number;
  status: DuesStatus;
};

export type PaymentRow = {
  id: string;
  memberId: string;
  fiscalYear: number;
  paymentDate: string;
  amountCents: number;
  method: string;
  notes: string | null;
  recordedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MemberPaymentLog = {
  member: {
    id: string;
    memberNumber: number | null;
    firstName: string;
    lastName: string;
    email: string;
    duesCategory: string;
  };
  settings: { individualAmountCents: number; familyAmountCents: number } | null;
  expectedAmountCents: number;
  totalPaidCents: number;
  status: DuesStatus;
  payments: PaymentRow[];
};

export type MemberSelfDues = {
  member: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    duesCategory: string;
  };
  settings: { individualAmountCents: number; familyAmountCents: number } | null;
  expectedAmountCents: number;
  totalPaidCents: number;
  status: DuesStatus;
  /** Payment rows without recordedByUserId (omitted for privacy) */
  payments: Omit<PaymentRow, "recordedByUserId">[];
};

// ---------------------------------------------------------------------------
// listMemberDuesStatus
// ---------------------------------------------------------------------------

/**
 * Returns dues status for all active members for a given fiscal year.
 *
 * The expected amount is resolved by joining dues_settings for the fiscal year
 * and picking individual_amount_cents or family_amount_cents based on the
 * member's dues_category. If no dues_settings row exists, expectedAmountCents
 * is 0, which deriveStatus treats as "unpaid".
 *
 * @param fiscalYear   e.g. 2026
 * @param opts.search  Optional name/email substring filter (case-insensitive)
 */
export async function listMemberDuesStatus(
  fiscalYear: number,
  opts: { search?: string } = {},
): Promise<MemberDuesSummary[]> {
  // Use a raw SQL aggregate query via Drizzle's sql tag so we can do the
  // CASE/COALESCE/SUM in one round-trip without N+1 queries.
  const { search } = opts;

  // Build parameterized WHERE clause fragments
  const searchFilter =
    search && search.trim()
      ? sql`AND (
          m.first_name ILIKE ${"%" + search.trim() + "%"}
          OR m.last_name ILIKE ${"%" + search.trim() + "%"}
          OR m.email ILIKE ${"%" + search.trim() + "%"}
        )`
      : sql``;

  const rows = await db.execute<{
    member_id: string;
    member_number: number | null;
    first_name: string;
    last_name: string;
    email: string;
    is_active: boolean;
    dues_category: string;
    total_paid_cents: string; // Postgres returns bigint/numeric as string
    expected_amount_cents: number | null;
  }>(sql`
    SELECT
      m.id                                              AS member_id,
      m.member_number,
      m.first_name,
      m.last_name,
      m.email,
      m.is_active,
      m.dues_category,
      COALESCE(SUM(dp.amount_cents), 0)                AS total_paid_cents,
      CASE
        WHEN m.dues_category = 'family' THEN ds.family_amount_cents
        ELSE ds.individual_amount_cents
      END                                              AS expected_amount_cents
    FROM members m
    LEFT JOIN dues_payments dp
      ON dp.member_id = m.id AND dp.fiscal_year = ${fiscalYear}
    LEFT JOIN dues_settings ds
      ON ds.fiscal_year = ${fiscalYear}
    WHERE m.is_active = true
    ${searchFilter}
    GROUP BY
      m.id, m.member_number, m.first_name, m.last_name, m.email,
      m.is_active, m.dues_category,
      ds.individual_amount_cents, ds.family_amount_cents
    ORDER BY m.last_name ASC, m.first_name ASC
  `);

  return rows.map((r) => {
    const totalPaidCents = Number(r.total_paid_cents);
    const expectedAmountCents = r.expected_amount_cents ?? 0;
    return {
      memberId: r.member_id,
      memberNumber: r.member_number,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      isActive: r.is_active,
      duesCategory: r.dues_category,
      totalPaidCents,
      expectedAmountCents,
      status: deriveStatus(totalPaidCents, expectedAmountCents),
    };
  });
}

// ---------------------------------------------------------------------------
// getDuesMethodTotals
// ---------------------------------------------------------------------------

/**
 * Returns raw dues_payments totals grouped by method for a fiscal year,
 * scoped to active members — the same population listMemberDuesStatus sums
 * for totalPaidCents, so the two stay consistent with each other.
 *
 * `opts.search` mirrors listMemberDuesStatus's name/email filter so the donut
 * chart stays in sync with the admin dues page's search box (the stat cards
 * it replaces were also search-scoped).
 *
 * Feeds computeDuesMethodComposition() in @/lib/dues, which does the
 * clamping/bucketing/percent math as a pure function.
 */
export async function getDuesMethodTotals(
  fiscalYear: number,
  opts: { search?: string } = {},
): Promise<Record<string, number>> {
  const { search } = opts;
  const searchFilter =
    search && search.trim()
      ? sql`AND (
          m.first_name ILIKE ${"%" + search.trim() + "%"}
          OR m.last_name ILIKE ${"%" + search.trim() + "%"}
          OR m.email ILIKE ${"%" + search.trim() + "%"}
        )`
      : sql``;

  const rows = await db.execute<{ method: string; total_cents: string }>(sql`
    SELECT dp.method, SUM(dp.amount_cents) AS total_cents
    FROM dues_payments dp
    JOIN members m ON m.id = dp.member_id
    WHERE dp.fiscal_year = ${fiscalYear} AND m.is_active = true
    ${searchFilter}
    GROUP BY dp.method
  `);

  const totals: Record<string, number> = {};
  for (const r of rows) {
    totals[r.method] = Number(r.total_cents);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// getMemberPaymentLog
// ---------------------------------------------------------------------------

/**
 * Returns a member's full payment log for a fiscal year, plus their computed
 * dues status.
 *
 * @param memberId   UUID of the member
 * @param fiscalYear e.g. 2026
 */
export async function getMemberPaymentLog(
  memberId: string,
  fiscalYear: number,
): Promise<MemberPaymentLog | null> {
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
    columns: {
      id: true,
      memberNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      duesCategory: true,
      isActive: true,
    },
  });

  if (!member) return null;

  const [settingsRow, payments] = await Promise.all([
    db.query.duesSettings.findFirst({
      where: eq(duesSettings.fiscalYear, fiscalYear),
    }),
    db
      .select()
      .from(duesPayments)
      .where(
        and(
          eq(duesPayments.memberId, memberId),
          eq(duesPayments.fiscalYear, fiscalYear),
        ),
      )
      .orderBy(asc(duesPayments.paymentDate)),
  ]);

  const settings = settingsRow
    ? {
        individualAmountCents: settingsRow.individualAmountCents,
        familyAmountCents: settingsRow.familyAmountCents,
      }
    : null;

  const expectedAmountCents = settings
    ? member.duesCategory === "family"
      ? settings.familyAmountCents
      : settings.individualAmountCents
    : 0;

  const totalPaidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);

  return {
    member: {
      id: member.id,
      memberNumber: member.memberNumber,
      firstName: member.firstName,
      lastName: member.lastName,
      email: member.email,
      duesCategory: member.duesCategory,
    },
    settings,
    expectedAmountCents,
    totalPaidCents,
    status: deriveStatus(totalPaidCents, expectedAmountCents),
    payments,
  };
}

// ---------------------------------------------------------------------------
// getDuesSettings / listKnownFiscalYears
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getActiveFiscalYear
// ---------------------------------------------------------------------------

/**
 * Returns the fiscal year marked as active in dues_settings (is_active = true).
 * Falls back to currentFiscalYear(new Date()) if no row is active.
 *
 * Use this as the default when no explicit ?fy= param is present.
 */
export async function getActiveFiscalYear(): Promise<number> {
  const row = await db.query.duesSettings.findFirst({
    where: eq(duesSettings.isActive, true),
    columns: { fiscalYear: true },
  });
  return row?.fiscalYear ?? currentFiscalYear(new Date());
}

// ---------------------------------------------------------------------------
// getDuesSettings / listKnownFiscalYears
// ---------------------------------------------------------------------------

/**
 * Returns the dues_settings row for a fiscal year, or null if not configured.
 */
export async function getDuesSettings(
  fiscalYear: number,
): Promise<{ id: string; fiscalYear: number; individualAmountCents: number; familyAmountCents: number; notes: string | null; isActive: boolean } | null> {
  const row = await db.query.duesSettings.findFirst({
    where: eq(duesSettings.fiscalYear, fiscalYear),
  });
  return row ?? null;
}

/**
 * Returns a sorted (descending) list of fiscal years for which we have either
 * dues_payments rows or dues_settings rows. Used to populate the year selector.
 */
export async function listKnownFiscalYears(): Promise<number[]> {
  const [fromPayments, fromSettings] = await Promise.all([
    db.execute<{ fiscal_year: number }>(
      sql`SELECT DISTINCT fiscal_year FROM dues_payments ORDER BY fiscal_year DESC`,
    ),
    db.execute<{ fiscal_year: number }>(
      sql`SELECT DISTINCT fiscal_year FROM dues_settings ORDER BY fiscal_year DESC`,
    ),
  ]);

  const years = new Set<number>([
    ...fromPayments.map((r) => Number(r.fiscal_year)),
    ...fromSettings.map((r) => Number(r.fiscal_year)),
  ]);

  return Array.from(years).sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// getMemberDuesForUser  (member self-view)
// ---------------------------------------------------------------------------

/**
 * Returns a member's own dues status for a fiscal year.
 *
 * Ownership enforcement: the caller passes their own session.user.memberId.
 * This function only fetches the member row matching that exact ID. It never
 * accepts a memberId that differs from the caller's own, because the call site
 * (the member self-view route) passes session.user.memberId directly — it
 * cannot be influenced by a request parameter without an explicit re-check.
 *
 * Returns null if the member row doesn't exist or if memberId is falsy.
 *
 * recordedByUserId is intentionally omitted from the returned payment rows.
 */
export async function getMemberDuesForUser(
  memberId: string,
  fiscalYear: number,
): Promise<MemberSelfDues | null> {
  if (!memberId) return null;

  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      duesCategory: true,
    },
  });

  if (!member) return null;

  const [settingsRow, allPayments] = await Promise.all([
    db.query.duesSettings.findFirst({
      where: eq(duesSettings.fiscalYear, fiscalYear),
    }),
    db
      .select({
        id: duesPayments.id,
        memberId: duesPayments.memberId,
        fiscalYear: duesPayments.fiscalYear,
        paymentDate: duesPayments.paymentDate,
        amountCents: duesPayments.amountCents,
        method: duesPayments.method,
        notes: duesPayments.notes,
        createdAt: duesPayments.createdAt,
        updatedAt: duesPayments.updatedAt,
        // recordedByUserId intentionally excluded
      })
      .from(duesPayments)
      .where(
        and(
          eq(duesPayments.memberId, memberId),
          eq(duesPayments.fiscalYear, fiscalYear),
        ),
      )
      .orderBy(asc(duesPayments.paymentDate)),
  ]);

  const settings = settingsRow
    ? {
        individualAmountCents: settingsRow.individualAmountCents,
        familyAmountCents: settingsRow.familyAmountCents,
      }
    : null;

  const expectedAmountCents = settings
    ? member.duesCategory === "family"
      ? settings.familyAmountCents
      : settings.individualAmountCents
    : 0;

  const totalPaidCents = allPayments.reduce((sum, p) => sum + p.amountCents, 0);

  return {
    member,
    settings,
    expectedAmountCents,
    totalPaidCents,
    status: deriveStatus(totalPaidCents, expectedAmountCents),
    payments: allPayments,
  };
}

