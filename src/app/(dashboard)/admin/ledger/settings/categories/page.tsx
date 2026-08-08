import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntities, getFunds } from "@/lib/ledger-queries";
import { listCategoriesForAdmin, toCategoryDTO } from "@/lib/ledger-category-queries";
import { currentFiscalYear } from "@/lib/fiscal-year";
import CategoryList from "@/components/admin/ledger/category-list";
import type { EntityCategoryData } from "@/lib/ledger-category-ui";

export const dynamic = "force-dynamic";

/**
 * Ledger Category Management — `/admin/ledger/settings/categories`
 * (docs/work-log/2026-08-07-ledger-category-management.md, DECISION-065/066).
 *
 * Sub-route of Settings (not a tab) per architect Ruling #3 — a category
 * list across 2 entities x up to 4 fund kinds x 2 flows needs its own width
 * and layout, not a form's max-w-2xl. Server Component: fetches every
 * category (active AND inactive) for every entity up front and hands the
 * whole dataset to the client-side CategoryList, which owns filtering/
 * grouping/dialogs — a ~100-row list doesn't need pagination or a second
 * fetch round-trip for local filtering (Phase 3 UI Design).
 */
export default async function AdminLedgerCategoriesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);
  if (!canManage) redirect("/admin/ledger");

  const entities = await getEntities();

  const entityData: EntityCategoryData[] = await Promise.all(
    entities.map(async (entity) => {
      const [funds, categories] = await Promise.all([
        getFunds(entity.id),
        listCategoriesForAdmin(entity.id, { includeInactive: true }),
      ]);
      return {
        id: entity.id,
        slug: entity.slug,
        name: entity.name,
        shortName: entity.shortName,
        funds: funds.map((f) => ({ kind: f.kind, name: f.name })),
        categories: categories.map((c) => {
          const dto = toCategoryDTO(c);
          return {
            id: dto.id,
            name: dto.name,
            fundKind: dto.fundKind,
            flow: dto.flow as "income" | "expense",
            sortOrder: dto.sortOrder,
            isActive: dto.isActive,
            countsAsGiving: dto.countsAsGiving,
            form990Line: dto.form990Line,
          };
        }),
      };
    }),
  );

  const fiscalYear = currentFiscalYear(new Date());

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin/ledger/settings"
          className="text-lions-blue hover:underline text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; Ledger Settings
        </Link>
      </div>

      {/* Header */}
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Manage Categories</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rename, deactivate, merge, and flag ledger categories across the Club and Foundation
          books. These are destructive edits to live financial history — every rename, merge,
          deactivation, and flag change is logged.
        </p>
      </div>

      <CategoryList entities={entityData} currentFiscalYear={fiscalYear} />
    </div>
  );
}
