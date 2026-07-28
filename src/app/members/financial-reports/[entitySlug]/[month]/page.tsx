import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getEntities, getEntity, getFunds } from "@/lib/ledger-queries";
import {
  getMonthlyStatement,
  getLatestOpenMonthForEntity,
  MEMBER_EXPOSED_FUND_KINDS,
} from "@/lib/financial-report-queries";
import { buildRecentMonthOptions, ensureMonthOption, type MonthOption } from "@/lib/financial-report-ui";
import FinancialReportPicker, {
  type FinancialReportEntityOption,
} from "@/components/members/financial-report-picker";
import MonthlyStatementTable from "@/components/members/monthly-statement-table";
import PrintStatementButton from "@/components/members/print-statement-button";

export const dynamic = "force-dynamic";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/**
 * Statement detail page — /members/financial-reports/[entitySlug]/[month]
 * (2026-07-28-monthly-financial-report, Phase 4 UI half). Server Component:
 * auth() + inline memberId gate (same pattern as /members/impact). Renders
 * exactly three distinct states per the Phase 3 design's discriminated
 * union — see the three branches below. The gate is re-checked by
 * getMonthlyStatement() on every request, never trusted from the picker's
 * list, so a direct-URL hit on an unreconciled or non-exposed-fund route is
 * always handled safely regardless of how the request arrived.
 */
export default async function FinancialStatementDetailPage({
  params,
}: {
  params: Promise<{ entitySlug: string; month: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const { entitySlug, month } = await params;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12 print:hidden">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Monthly Financial Statements</h1>
          <p className="text-blue-100">Club-wide financial accountability, month by month.</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10 max-w-4xl">
        <Link
          href="/members/financial-reports"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6 print:hidden"
        >
          &larr; All Statements
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view the financial statements.
            </p>
          </div>
        ) : (
          <StatementBody entitySlug={entitySlug} month={month} />
        )}
      </div>
    </div>
  );
}

async function StatementBody({ entitySlug, month }: { entitySlug: string; month: string }) {
  // Validate month format before touching the DB — garbage input 404s, never
  // leaks a query error.
  if (!MONTH_PATTERN.test(month)) notFound();

  const entity = await getEntity(entitySlug);
  if (!entity) notFound();

  const funds = await getFunds(entity.id);
  const fund = funds.find((f) => (MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(f.kind));
  if (!fund) notFound();

  const result = await getMonthlyStatement(fund, month);
  // null = fund not a member-exposed kind (defense-in-depth; unreachable via
  // this route today since `fund` was already filtered above, but the query
  // layer's own contract treats null as "not a member-facing surface at all").
  if (result === null) notFound();

  // Build the picker's entity/month option lists — same computation as the
  // landing page, so switching entity/month from here lands on a page that
  // already knows its own available months.
  const allEntities = await getEntities();
  const pickerEntities: FinancialReportEntityOption[] = (
    await Promise.all(
      allEntities.map(async (e) => {
        const eFunds = await getFunds(e.id);
        const eFund = eFunds.find((f) =>
          (MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(f.kind),
        );
        if (!eFund) return null;
        const latestOpen = await getLatestOpenMonthForEntity(e.id);
        let months: MonthOption[] = latestOpen ? buildRecentMonthOptions(latestOpen) : [];
        if (e.slug === entitySlug) {
          // Guarantee the currently-viewed month is selectable even when it
          // falls outside the generated window (e.g. a direct-URL hit on a
          // future/gated month) — the picker must always reflect reality.
          months = ensureMonthOption(months, month);
        }
        return { slug: e.slug, label: `${e.shortName ?? e.name} — ${eFund.name}`, months };
      }),
    )
  )
    .filter((c): c is NonNullable<typeof c> => c !== null)
    // Drop a sibling entity with zero available months (nothing ever
    // reconciled there) — the current entity always keeps >=1 entry thanks
    // to ensureMonthOption() above, so this only ever prunes the OTHER one.
    .filter((c) => c.slug === entitySlug || c.months.length > 0);

  const entityLabel = entity.shortName ?? entity.name;

  return (
    <div className="space-y-6">
      {pickerEntities.length > 0 && (
        <FinancialReportPicker
          entities={pickerEntities}
          currentEntitySlug={entitySlug}
          currentMonth={month}
        />
      )}

      {result.status === "gated" ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Statement Not Ready Yet</h2>
          <p className="text-sm">
            This month&rsquo;s statement isn&rsquo;t ready yet &mdash; the treasurer is still
            reconciling it. Check back soon.
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-end print:hidden">
            <PrintStatementButton />
          </div>
          <MonthlyStatementTable
            entityLabel={entityLabel}
            fundName={fund.name}
            statement={result.statement}
          />
        </>
      )}
    </div>
  );
}
