import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  listDonors,
  listPendingAcknowledgments,
  listAcknowledgmentsSummary,
  listUnlinkedGifts,
  listLedgerFiscalYears,
  getEntities,
} from "@/lib/ledger-queries";
import { currentFiscalYear } from "@/lib/fiscal-year";
import DonorList from "@/components/admin/ledger/donor-list";
import AckQueue from "@/components/admin/ledger/ack-queue";
import SentAckList from "@/components/admin/ledger/sent-ack-list";
import UnlinkedGiftsList from "@/components/admin/ledger/unlinked-gifts-list";
import FiscalYearSelector from "@/components/admin/ledger/fiscal-year-selector";

export const dynamic = "force-dynamic";

type TabParam = "donors" | "acknowledgments" | "sent" | "unlinked";

export default async function AdminLedgerDonorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; search?: string; fy?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Donor page requires LEDGER_RECORD — donor PII is treasurer/admin only
  const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);
  if (!canRecord) redirect("/admin/ledger");

  const canManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);

  const { tab: tabParam, search, fy: fyParam } = await searchParams;
  const validTabs: TabParam[] = ["donors", "acknowledgments", "sent", "unlinked"];
  const activeTab: TabParam =
    tabParam && validTabs.includes(tabParam as TabParam)
      ? (tabParam as TabParam)
      : "donors";

  const currentFY = currentFiscalYear(new Date());
  // "all" is the worklist's own sentinel (FiscalYearSelector's allowAll
  // option) — translated to `fiscalYear: undefined` before calling
  // listUnlinkedGifts(), never passed through as a parse failure. Mirrors
  // the search/page.tsx:237 precedent for this exact translation.
  const unlinkedFyValue: number | "all" =
    fyParam === "all" ? "all" : fyParam && !isNaN(parseInt(fyParam, 10)) ? parseInt(fyParam, 10) : currentFY;

  // Always load the pending ack list (for count badge + tab content).
  // Donors list, sent-ack list, and the unlinked-gifts list are only loaded
  // on their own tabs.
  //
  // `anyUnsentAck` answers "does any unsent acknowledgment exist at all,"
  // with no $250 floor — this deliberately does NOT reuse `pendingAcks`
  // (which floors at $250), so the "Generate Letters…" entry point stays
  // reachable even when the only unsent acknowledgment is sub-$250
  // (docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md Part 3,
  // bug #1). `pendingAcks` and its badge count are untouched, and must stay
  // meaning "needs an IRS letter".
  const [donors, pendingAcks, sentAcks, anyUnsentAckRows, unlinkedGifts, entities] = await Promise.all([
    activeTab === "donors" ? listDonors({ search: search ?? undefined }) : Promise.resolve([]),
    listPendingAcknowledgments(),
    activeTab === "sent"
      ? listAcknowledgmentsSummary({ sentOnly: true, includePii: canRecord })
      : Promise.resolve([]),
    activeTab === "acknowledgments"
      ? listAcknowledgmentsSummary({ pendingOnly: true, includePii: false })
      : Promise.resolve([]),
    activeTab === "unlinked"
      ? listUnlinkedGifts({ fiscalYear: unlinkedFyValue === "all" ? undefined : unlinkedFyValue })
      : Promise.resolve([]),
    activeTab === "unlinked" ? getEntities() : Promise.resolve([]),
  ]);

  const pendingAckCount = pendingAcks.length;
  const anyUnsentAck = anyUnsentAckRows.length > 0;

  const foundation = entities.find((e) => e.donationsDeductible === true) ?? null;
  const unlinkedFiscalYears =
    activeTab === "unlinked" && foundation ? await listLedgerFiscalYears(foundation.id) : [currentFY];

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
      <div>
        <p className="uppercase tracking-widest text-sm text-lions-gold mb-1 font-semibold">
          The Ledger
        </p>
        <h1 className="text-3xl font-bold text-gray-900">Donors &amp; Acknowledgments</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track Foundation donors and IRS-required gift acknowledgment letters (Pub. 1771).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-0">
        {(["donors", "unlinked", "acknowledgments", "sent"] as TabParam[]).map((tab) => {
          const isActive = tab === activeTab;
          const label =
            tab === "donors"
              ? "Donors"
              : tab === "unlinked"
                ? "Unlinked Gifts"
                : tab === "acknowledgments"
                  ? "Pending Acknowledgments"
                  : "Sent Acknowledgments";
          const count = tab === "acknowledgments" ? pendingAckCount : null;
          return (
            <Link
              key={tab}
              href={`/admin/ledger/donors?tab=${tab}`}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue -mb-px ${
                isActive
                  ? "bg-white border border-b-white border-gray-200 text-lions-blue"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
              {count !== null && count > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1 text-xs font-bold ${
                    isActive
                      ? "bg-lions-blue text-white"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "donors" && (
        <DonorList
          donors={donors}
          canRecord={canRecord}
          canManage={canManage}
        />
      )}

      {activeTab === "unlinked" && (
        <div className="space-y-4">
          <FiscalYearSelector
            fiscalYears={unlinkedFiscalYears}
            currentFY={unlinkedFyValue}
            basePath="/admin/ledger/donors"
            allowAll
          />
          <UnlinkedGiftsList rows={unlinkedGifts} canRecord={canRecord} />
        </div>
      )}

      {activeTab === "acknowledgments" && (
        <div className="space-y-4">
          {canRecord && anyUnsentAck && (
            <div className="flex justify-end">
              <Link
                href="/admin/ledger/donors/letters"
                className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[40px] inline-flex items-center"
              >
                Generate Letters&hellip;
              </Link>
            </div>
          )}
          <AckQueue rows={pendingAcks} canRecord={canRecord} />
        </div>
      )}

      {activeTab === "sent" && (
        <SentAckList rows={sentAcks} canRecord={canRecord} />
      )}
    </div>
  );
}
