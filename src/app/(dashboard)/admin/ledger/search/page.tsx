import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntities, getFunds, getCategories, getBankAccounts } from "@/lib/ledger-queries";
import { listLedgerFiscalYears } from "@/lib/ledger-queries";
import { currentFiscalYear } from "@/lib/fiscal-year";
import { BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE } from "@/lib/ledger";
import {
  searchTransactions,
  searchBudgetLines,
  type LedgerSearchFilters,
  type TransactionSearchResult,
  type BudgetLineSearchResult,
} from "@/lib/ledger-search-queries";
import LoadErrorCard from "@/components/admin/ledger/load-error-card";
import LedgerSearchBox from "@/components/admin/ledger/ledger-search-box";
import SearchFilters from "@/components/admin/ledger/search-filters";
import SearchResultsTransactions from "@/components/admin/ledger/search-results-transactions";
import SearchResultsBudgetLines from "@/components/admin/ledger/search-results-budget-lines";

export const dynamic = "force-dynamic";

const ALL_CAUSES: readonly string[] = [...BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE];

interface RawSearchParams {
  q?: string;
  fy?: string;
  entity?: string;
  fund?: string;
  category?: string;
  cause?: string;
  bankAccount?: string;
  amountMin?: string;
  amountMax?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  txnPage?: string;
  budgetPage?: string;
}

function parseDollarsToCents(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (isNaN(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

function parsePageOrDefault(raw?: string): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return !isNaN(n) && n >= 1 ? n : 1;
}

function buildResultUrl(base: URLSearchParams, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams(base);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) params.delete(k);
    else params.set(k, v);
  }
  const query = params.toString();
  return `/admin/ledger/search${query ? `?${query}` : ""}`;
}

/**
 * Ledger & Budget Search (Phase 3 design, DECISION-062/063,
 * docs/work-log/2026-08-06-ledger-search.md). Server Component — all filter
 * state lives in searchParams, driving a server-side re-render on every
 * navigation. Two independent, independently-paginated, independently-
 * subtotaled result groups (Transactions, Budget lines), each gated by its
 * own FEATURES check so a caller lacking one permission never triggers that
 * side's query at all (never fetch-then-hide — see the page-level and
 * section-level gates below, Phase 3 Permissions section, named unit test 4).
 */
export default async function AdminLedgerSearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Page-level gate — independent of the /admin/ledger dashboard's own
  // hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE]) gate, so a
  // hypothetical budget-only role can reach this page directly even though
  // it can't reach the dashboard it's linked from (Phase 2 Section 7 /
  // residual-risk note).
  const canAccess = await hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.BUDGET_VIEW]);
  if (!canAccess) redirect("/access-pending");

  // Section-level gates — decide WHETHER each query function is ever called
  // at all (Filter Semantics rule 2: missing permission omits the whole
  // section, header included; never fetch-then-hide). This is Phase 3's
  // named unit test 4.
  const [canViewTxns, canViewBudget] = await Promise.all([
    hasFeature(session.user.id, FEATURES.LEDGER_VIEW),
    hasFeature(session.user.id, FEATURES.BUDGET_VIEW),
  ]);

  const raw = await searchParams;

  let entities;
  try {
    entities = await getEntities();
  } catch {
    return <LoadErrorCard backHref="/admin/ledger" />;
  }
  if (entities.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No ledger entities found. Contact the administrator.
      </div>
    );
  }

  const currentFY = currentFiscalYear(new Date());
  const q = raw.q ?? "";

  // "all" -> null (omit FY condition entirely). Anything else non-numeric
  // falls back to current FY, mirroring [fundSlug]/page.tsx's own
  // parsedFY/isNaN fallback pattern.
  let fiscalYear: number | null;
  if (raw.fy === "all") {
    fiscalYear = null;
  } else {
    const parsed = raw.fy ? parseInt(raw.fy, 10) : NaN;
    fiscalYear = !isNaN(parsed) && parsed > 2000 && parsed < 2100 ? parsed : currentFY;
  }

  const validEntitySlugs = entities.map((e) => e.slug);
  const resolvedEntity =
    raw.entity && validEntitySlugs.includes(raw.entity)
      ? entities.find((e) => e.slug === raw.entity)
      : undefined;

  // Fund/category/bank-account/FY option data for the filter panel — fetched
  // for EVERY entity (cheap, a handful of rows total) per Phase 3's URL/State
  // Contract, so the dropdowns can be labeled by entity when no entity filter
  // is active yet.
  let perEntity;
  try {
    perEntity = await Promise.all(
      entities.map(async (e) => {
        const [funds, categories, bankAccounts, fiscalYears] = await Promise.all([
          getFunds(e.id),
          getCategories(e.id),
          getBankAccounts(e.id),
          listLedgerFiscalYears(e.id),
        ]);
        return { entity: e, funds, categories, bankAccounts, fiscalYears };
      }),
    );
  } catch {
    return <LoadErrorCard backHref="/admin/ledger" />;
  }

  // `fund` is only honored when `entity` also resolves — fund slugs aren't
  // globally unique (Edge Cases: "fund param without a valid entity param").
  let resolvedFundSlug: string | undefined;
  let fundId: string | undefined;
  if (resolvedEntity && raw.fund) {
    const scopedFunds = perEntity.find((pe) => pe.entity.id === resolvedEntity.id)?.funds ?? [];
    const match = scopedFunds.find((f) => f.slug === raw.fund);
    if (match) {
      resolvedFundSlug = match.slug;
      fundId = match.id;
    }
  }

  const cause = raw.cause && ALL_CAUSES.includes(raw.cause) ? raw.cause : undefined;
  const status =
    raw.status === "posted" || raw.status === "pending" || raw.status === "rejected"
      ? raw.status
      : undefined;
  const amountMinCents = parseDollarsToCents(raw.amountMin);
  const amountMaxCents = parseDollarsToCents(raw.amountMax);
  const txnPage = parsePageOrDefault(raw.txnPage);
  const budgetPage = parsePageOrDefault(raw.budgetPage);

  const filters: LedgerSearchFilters = {
    q,
    fiscalYear,
    entityId: resolvedEntity?.id,
    fundId,
    categoryId: raw.category || undefined,
    cause,
    bankAccountId: raw.bankAccount || undefined,
    amountMinCents,
    amountMaxCents,
    dateFrom: raw.dateFrom || undefined,
    dateTo: raw.dateTo || undefined,
    status,
  };

  let txnResult: TransactionSearchResult | null = null;
  let budgetResult: BudgetLineSearchResult | null = null;
  try {
    const [t, b] = await Promise.all([
      canViewTxns ? searchTransactions(filters, txnPage) : Promise.resolve(null),
      canViewBudget ? searchBudgetLines(filters, budgetPage) : Promise.resolve(null),
    ]);
    txnResult = t;
    budgetResult = b;
  } catch {
    return <LoadErrorCard backHref="/admin/ledger" />;
  }

  // Filter-panel option lists — labeled with the entity's short name only
  // when no entity filter is active yet (Phase 3 URL/State Contract).
  const entityOptions = entities.map((e) => ({ slug: e.slug, label: e.shortName ?? e.name }));
  const fundOptions = perEntity.flatMap((pe) =>
    pe.funds.map((f) => ({
      slug: f.slug,
      entitySlug: pe.entity.slug,
      label: resolvedEntity ? f.name : `${f.name} (${pe.entity.shortName ?? pe.entity.name})`,
    })),
  );
  const categoryOptions = perEntity.flatMap((pe) =>
    pe.categories.map((c) => ({
      id: c.id,
      entitySlug: pe.entity.slug,
      label: resolvedEntity ? c.name : `${c.name} (${pe.entity.shortName ?? pe.entity.name})`,
    })),
  );
  const bankAccountOptions = perEntity.flatMap((pe) =>
    pe.bankAccounts.map((b) => ({
      id: b.id,
      entitySlug: pe.entity.slug,
      label: resolvedEntity ? b.name : `${b.name} (${pe.entity.shortName ?? pe.entity.name})`,
    })),
  );
  const fiscalYearOptions = Array.from(
    new Set(perEntity.flatMap((pe) => pe.fiscalYears).concat(currentFY)),
  ).sort((a, b) => b - a);

  const fyValue = raw.fy === "all" ? "all" : raw.fy && !isNaN(parseInt(raw.fy, 10)) ? String(fiscalYear) : "";

  // Pagination base — preserves every raw query param verbatim except the
  // page being overridden (sync-log/page.tsx's pageUrl() pattern, generalized
  // to two independent page params).
  const baseParams = new URLSearchParams();
  const rawEntries: [string, string | undefined][] = [
    ["q", raw.q],
    ["fy", raw.fy],
    ["entity", raw.entity],
    ["fund", raw.fund],
    ["category", raw.category],
    ["cause", raw.cause],
    ["bankAccount", raw.bankAccount],
    ["amountMin", raw.amountMin],
    ["amountMax", raw.amountMax],
    ["dateFrom", raw.dateFrom],
    ["dateTo", raw.dateTo],
    ["status", raw.status],
    ["txnPage", raw.txnPage],
    ["budgetPage", raw.budgetPage],
  ];
  for (const [k, v] of rawEntries) {
    if (v) baseParams.set(k, v);
  }
  const txnPageHref = (p: number) => buildResultUrl(baseParams, { txnPage: p > 1 ? String(p) : undefined });
  const budgetPageHref = (p: number) =>
    buildResultUrl(baseParams, { budgetPage: p > 1 ? String(p) : undefined });

  const bothViewable = canViewTxns && canViewBudget;
  const bothEmpty =
    bothViewable && (txnResult?.totalCount ?? 0) === 0 && (budgetResult?.totalCount ?? 0) === 0;
  const hasInapplicableFilters = !!(raw.bankAccount || raw.dateFrom || raw.dateTo || raw.status);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/ledger"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Overview
        </Link>
      </div>

      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Search</h1>
        <p className="mt-1 text-sm text-gray-500">
          Search transactions and budget lines across Club and Foundation books.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-4">
        <LedgerSearchBox defaultValue={q} />
      </div>

      <SearchFilters
        value={{
          q,
          fy: fyValue,
          entity: resolvedEntity?.slug ?? "",
          fund: resolvedFundSlug ?? "",
          categoryId: raw.category ?? "",
          cause: cause ?? "",
          bankAccountId: raw.bankAccount ?? "",
          amountMin: raw.amountMin ?? "",
          amountMax: raw.amountMax ?? "",
          dateFrom: raw.dateFrom ?? "",
          dateTo: raw.dateTo ?? "",
          status: status ?? "",
        }}
        currentFY={currentFY}
        fiscalYearOptions={fiscalYearOptions}
        entityOptions={entityOptions}
        fundOptions={fundOptions}
        categoryOptions={categoryOptions}
        bankAccountOptions={bankAccountOptions}
        causeOptions={ALL_CAUSES}
      />

      {bothEmpty ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <p className="font-medium">
            {q.trim()
              ? `No transactions or budget lines match "${q.trim()}".`
              : "No transactions or budget lines match these filters."}
          </p>
          <p className="mt-2 text-sm">Try broadening your search or clearing filters.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {canViewTxns && txnResult && (
            <SearchResultsTransactions
              result={txnResult}
              q={q}
              entityScoped={!!resolvedEntity}
              pageHref={txnPageHref}
            />
          )}
          {canViewBudget && budgetResult && (
            <SearchResultsBudgetLines
              result={budgetResult}
              q={q}
              entityScoped={!!resolvedEntity}
              fyScoped={fiscalYear !== null}
              hasInapplicableFilters={hasInapplicableFilters}
              pageHref={budgetPageHref}
            />
          )}
        </div>
      )}
    </div>
  );
}
