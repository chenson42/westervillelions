import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getEntities, getFunds } from "@/lib/ledger-queries";
import { getLatestOpenMonthForEntity, MEMBER_EXPOSED_FUND_KINDS } from "@/lib/financial-report-queries";
import { buildRecentMonthOptions, type MonthOption } from "@/lib/financial-report-ui";
import FinancialReportPicker, {
  type FinancialReportEntityOption,
} from "@/components/members/financial-report-picker";

export const dynamic = "force-dynamic";

/**
 * Landing/picker page for the member-visible Monthly Statement of Financial
 * Condition — /members/financial-reports (2026-07-28-monthly-financial-report,
 * Phase 4 UI half). Server Component: auth() + inline memberId gate, IDENTICAL
 * to /members/impact's pattern (no redirect on an unlinked account, no
 * FEATURES check — every linked member sees every available month for both
 * entities, per the locked "expose accountability to the entire club"
 * decision).
 */
export default async function FinancialReportsLandingPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Monthly Financial Statements</h1>
          <p className="text-blue-100 max-w-2xl">
            The same monthly Statement of Financial Condition the treasurer reports to the board —
            published here for every member, as soon as a month is reconciled.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <Link
          href="/members"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Member Portal
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
          <EntityStatementCards />
        )}
      </div>
    </div>
  );
}

async function EntityStatementCards() {
  const entities = await getEntities();

  const rawCards = await Promise.all(
    entities.map(async (entity) => {
      const funds = await getFunds(entity.id);
      const fund = funds.find((f) =>
        (MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(f.kind),
      );
      if (!fund) return null; // defensive — every seeded entity has one exposed fund

      const latestOpen = await getLatestOpenMonthForEntity(entity.id);
      const months: MonthOption[] = latestOpen ? buildRecentMonthOptions(latestOpen) : [];

      return {
        entitySlug: entity.slug,
        entityLabel: entity.shortName ?? entity.name,
        fundName: fund.name,
        months,
      };
    }),
  );

  const cards = rawCards.filter((c): c is NonNullable<typeof c> => c !== null);
  const anyAvailable = cards.some((c) => c.months.length > 0);

  if (cards.length === 0 || !anyAvailable) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p className="text-base">
          Monthly statements will appear here once the treasurer reconciles a month.
        </p>
      </div>
    );
  }

  const pickerEntities: FinancialReportEntityOption[] = cards
    .filter((c) => c.months.length > 0)
    .map((c) => ({ slug: c.entitySlug, label: `${c.entityLabel} — ${c.fundName}`, months: c.months }));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="grid sm:grid-cols-2 gap-6">
        {cards.map((card) => (
          <div key={card.entitySlug} className="bg-white rounded-2xl shadow-sm p-6">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-1">
              {card.entityLabel}
            </p>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{card.fundName}</h3>
            {card.months.length === 0 ? (
              <p className="text-sm text-gray-500">No statements published yet.</p>
            ) : (
              <Link
                href={`/members/financial-reports/${card.entitySlug}/${card.months[0].value}`}
                className="inline-flex w-full items-center justify-center bg-lions-blue text-white px-4 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                View {card.months[0].label} Statement
              </Link>
            )}
          </div>
        ))}
      </div>

      {pickerEntities.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <p className="text-sm font-medium text-gray-700 mb-3">Or view an earlier month</p>
          <FinancialReportPicker
            entities={pickerEntities}
            currentEntitySlug={pickerEntities[0].slug}
            currentMonth={pickerEntities[0].months[0].value}
          />
        </div>
      )}
    </div>
  );
}
