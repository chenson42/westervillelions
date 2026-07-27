import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntities, getComplianceOverview, getSettings } from "@/lib/ledger-queries";
import { currentFiscalYear } from "@/lib/fiscal-year";
import type { LedgerSettings } from "@/lib/db/schema";

import BankTransitionSection from "@/components/admin/ledger/guide/bank-transition-section";
import BooksRegisterSection from "@/components/admin/ledger/guide/books-register-section";
import ZeffyFundRoutingSection from "@/components/admin/ledger/guide/zeffy-fund-routing-section";
import DuesSection from "@/components/admin/ledger/guide/dues-section";
import ReimbursementsSection from "@/components/admin/ledger/guide/reimbursements-section";
import UncashedChecksSection from "@/components/admin/ledger/guide/uncashed-checks-section";
import ComplianceCalendarSection, {
  type Entity990Determination,
} from "@/components/admin/ledger/guide/compliance-calendar-section";
import GuardrailsSection from "@/components/admin/ledger/guide/guardrails-section";
import ReportsSection from "@/components/admin/ledger/guide/reports-section";
import BudgetingSection from "@/components/admin/ledger/guide/budgeting-section";
import ReconciliationSection from "@/components/admin/ledger/guide/reconciliation-section";
import SettingsSection from "@/components/admin/ledger/guide/settings-section";

export const dynamic = "force-dynamic";

const TOC: { id: string; label: string }[] = [
  { id: "bank-transition", label: "Treasurer Transition — Bank Account" },
  { id: "books-register", label: "Books & the Register" },
  { id: "zeffy-fund-routing", label: "Zeffy & Fund Routing" },
  { id: "dues", label: "Dues" },
  { id: "reimbursements", label: "Reimbursements & Approvals" },
  { id: "uncashed-checks", label: "Uncashed Checks" },
  { id: "compliance-990", label: "Compliance Calendar — Form 990" },
  { id: "guardrails", label: "Compliance Guardrails" },
  { id: "reports", label: "Reports" },
  { id: "budgeting", label: "Budgeting" },
  { id: "reconciliation", label: "Bank Reconciliation" },
  { id: "settings", label: "Ledger Settings & Annual Review" },
];

/**
 * Treasury User's Guide — /admin/ledger/guide
 *
 * A single, linear, in-app guide to The Ledger for the treasurer and a
 * future successor (Phase 1/3 design). Pure Server Component, hardcoded
 * content composed from twelve section files under
 * src/components/admin/ledger/guide/ — see the Phase 3 design doc
 * (docs/work-log/2026-07-21-treasury-users-guide.md) for the full rationale,
 * and docs/work-log/2026-07-27-ledger-budgeting-guide.md for the Budgeting
 * section added after that design shipped.
 *
 * Exactly two live reads happen here (page.tsx stays the single place that
 * loads data, per architect Ruling 2): the current 990 determination per
 * entity, and the current Ledger settings recap. Both are try/catch-wrapped
 * per DECISION-037 — on failure the affected section renders a one-line
 * fallback instead of crashing the whole page. ensureFilingsForFY() is
 * deliberately NOT called here (unlike the Compliance page) — this is a
 * read-only page and must not trigger that function's write side effect;
 * determine990Result is computed from financial totals, independent of
 * filing rows.
 *
 * Donors & acknowledgments are intentionally NOT documented in this guide
 * (user's explicit 2026-07-21 exclusion, carried through all phases).
 */
export default async function TreasuryUsersGuidePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
    FEATURES.LEDGER_APPROVE,
  ]);
  if (!canView) redirect("/access-pending");

  // --- Live read 1: current 990 determination per entity ---
  let entity990s: Entity990Determination[] | null = null;
  try {
    const entities = await getEntities();
    if (entities.length > 0) {
      const fy = currentFiscalYear(new Date());
      const results = await Promise.all(
        entities.map(async (e) => {
          const overview = await getComplianceOverview(e.id, fy);
          if (!overview) return null;
          return {
            entityName: e.shortName ?? e.name,
            form: overview.determine990Result.form,
            why: overview.determine990Result.why,
          };
        }),
      );
      const resolved = results.filter((r): r is Entity990Determination => r !== null);
      entity990s = resolved.length > 0 ? resolved : null;
    }
  } catch {
    entity990s = null;
  }

  // --- Live read 2: current settings recap ---
  let settings: LedgerSettings | null = null;
  try {
    settings = await getSettings();
  } catch {
    settings = null;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="print:hidden">
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      {/* Header */}
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Treasurer&rsquo;s Guide</h1>
        <p className="mt-2 text-sm text-gray-600 max-w-2xl">
          A working reference to The Ledger for the current treasurer, and everything a future
          successor needs to pick this up cold — club process alongside the app&rsquo;s own
          surfaces. Read it start to finish, or jump straight to a topic below.
        </p>
      </div>

      {/* Table of contents — native <details>/<summary>, no client JS needed at any width */}
      <details open className="bg-gray-50 rounded-2xl p-5 print:hidden">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
          Contents
        </summary>
        <nav aria-label="Guide contents" className="mt-3">
          <ol className="space-y-1.5 text-sm list-decimal pl-5">
            {TOC.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </details>

      {/* Sections, in TOC order */}
      <div className="space-y-6">
        <BankTransitionSection />
        <BooksRegisterSection />
        <ZeffyFundRoutingSection />
        <DuesSection />
        <ReimbursementsSection />
        <UncashedChecksSection />
        <ComplianceCalendarSection entity990s={entity990s} />
        <GuardrailsSection />
        <ReportsSection />
        <BudgetingSection />
        <ReconciliationSection />
        <SettingsSection settings={settings} />
      </div>
    </div>
  );
}
