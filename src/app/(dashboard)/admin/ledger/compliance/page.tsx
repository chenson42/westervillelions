import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getEntities,
  getEntity,
  ensureFilingsForFY,
  getComplianceOverview,
  listLedgerFiscalYears,
} from "@/lib/ledger-queries";
import { currentFiscalYear } from "@/lib/fiscal-year";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import EntitySwitcher from "@/components/admin/ledger/entity-switcher";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";
import FilingsCalendar from "@/components/admin/ledger/filings-calendar";
import Panel990 from "@/components/admin/ledger/panel-990";
import StandingReminders from "@/components/admin/ledger/standing-reminders";
import type { GuardrailFlag } from "@/lib/ledger";

export const dynamic = "force-dynamic";

function guardrailBadgeClass(severity: GuardrailFlag["severity"]): string {
  switch (severity) {
    case "high":
      return "bg-red-50 border border-red-200 text-red-800";
    case "warn":
      return "bg-yellow-50 border border-yellow-200 text-yellow-800";
    case "info":
      return "bg-gray-50 border border-gray-200 text-gray-700";
    default:
      return "bg-gray-50 border border-gray-200 text-gray-700";
  }
}

function guardrailIconClass(severity: GuardrailFlag["severity"]): string {
  switch (severity) {
    case "high":
      return "text-red-500";
    case "warn":
      return "text-yellow-500";
    default:
      return "text-gray-400";
  }
}

export default async function AdminLedgerCompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; fy?: string }>;
}) {
  // --- Auth ---
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasAnyFeature(session.user.id, [
    FEATURES.LEDGER_VIEW,
    FEATURES.LEDGER_RECORD,
    FEATURES.LEDGER_MANAGE,
  ]);
  if (!canView) redirect("/access-pending");

  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  // --- Params ---
  const { entity: entityParam, fy: fyParam } = await searchParams;

  const entities = await getEntities();
  if (entities.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities found. Contact the administrator.
      </div>
    );
  }

  const validSlugs = entities.map((e) => e.slug);
  // An explicit but invalid ?entity= slug is a 404, not a silent fallback.
  if (entityParam && !validSlugs.includes(entityParam)) notFound();
  const resolvedSlug = entityParam ?? entities[0].slug;

  const entity = await getEntity(resolvedSlug);
  if (!entity) notFound();

  const currentFY = currentFiscalYear(new Date());
  const parsedFY = fyParam ? parseInt(fyParam, 10) : NaN;
  const fiscalYear =
    !isNaN(parsedFY) && parsedFY > 2000 && parsedFY < 2100 ? parsedFY : currentFY;

  // --- Ensure filings exist for this FY (idempotent rollover) ---
  await ensureFilingsForFY(entity.id, fiscalYear);

  // --- Data ---
  const [overview, fiscalYears] = await Promise.all([
    getComplianceOverview(entity.id, fiscalYear),
    listLedgerFiscalYears(entity.id),
  ]);

  const isFoundation = entity.slug === "foundation";

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
            The Ledger
          </p>
          <h1 className="text-3xl font-bold text-gray-900">
            {entity.shortName ?? entity.name} — Compliance
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {fiscalYearLabel(fiscalYear)} &bull; Filing calendar, 990 determination, and
            ongoing compliance reminders.
          </p>
        </div>

        {canManage && (
          <Link
            href="/admin/ledger/settings"
            className="inline-flex items-center gap-2 border-2 border-lions-blue text-lions-blue px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] self-start whitespace-nowrap"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Ledger Settings
          </Link>
        )}
      </div>

      {/* Entity switcher + FY selector */}
      <div className="flex flex-wrap items-center gap-4">
        <EntitySwitcher
          entities={entities}
          activeSlug={resolvedSlug}
          basePath="/admin/ledger/compliance"
        />
        <FiscalYearSelector
          fiscalYears={fiscalYears}
          currentFY={fiscalYear}
          basePath="/admin/ledger/compliance"
        />
      </div>

      {/* Guardrail flags (non-revocation — revocation is shown in Panel990) */}
      {overview && overview.guardrailFlags.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Guardrail Alerts
          </h2>
          {overview.guardrailFlags
            .filter((f) => !f.title.includes("revocation")) // revocation shown in Panel990
            .map((flag, i) => (
              <div
                key={i}
                className={`rounded-2xl p-4 ${guardrailBadgeClass(flag.severity)}`}
              >
                <div className="flex items-start gap-3">
                  <svg
                    className={`h-5 w-5 mt-0.5 flex-shrink-0 ${guardrailIconClass(flag.severity)}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold">{flag.title}</p>
                    <p className="text-xs mt-0.5">{flag.detail}</p>
                    {flag.policyCite && (
                      <p className="text-xs mt-1 opacity-70">{flag.policyCite}</p>
                    )}
                    {flag.linkHref && (
                      <Link
                        href={flag.linkHref}
                        className="text-xs font-semibold underline mt-1 inline-block focus:outline-none focus:ring-2 focus:ring-current rounded"
                      >
                        View flagged transactions &rarr;
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Filing calendar */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Filing Calendar</h2>
        {overview ? (
          <FilingsCalendar
            filings={overview.filings}
            entityId={entity.id}
            fiscalYear={fiscalYear}
            canRecord={canRecord}
            canManage={canManage}
          />
        ) : (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium">Unable to load filing calendar.</p>
            <p className="mt-1 text-sm">Refresh the page or contact the administrator.</p>
          </div>
        )}
      </section>

      {/* 990 determiner panel */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">990 Determination</h2>
        {overview ? (
          <Panel990
            determine990Result={overview.determine990Result}
            grossReceiptsCents={overview.grossReceiptsCents}
            entityBalanceCents={overview.entityBalanceCents}
            guardrailFlags={overview.guardrailFlags}
            isFoundation={isFoundation}
          />
        ) : (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium">990 determination unavailable.</p>
          </div>
        )}
      </section>

      {/* Standing reminders */}
      <section>
        <StandingReminders />
      </section>
    </div>
  );
}
