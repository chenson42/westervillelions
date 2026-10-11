import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getPendingApprovals, getSettings } from "@/lib/ledger-queries";
import ApprovalActions from "@/components/admin/ledger/approval-actions";
import ApprovalCard from "@/components/admin/ledger/approval-card";
import ApprovalBanner from "@/components/admin/ledger/approval-banner";
import ApprovalFundLabel from "@/components/admin/ledger/approval-fund-label";
import ApprovalHistory from "@/components/admin/ledger/approval-history";
import { HIGHLIGHT_CLASSES } from "@/components/admin/ledger/approval-highlight";
import ApprovalTabs from "@/components/admin/ledger/approval-tabs";
import { cosignDialogProps } from "@/components/admin/ledger/approval-dialog-logic";
import RowHighlighter from "@/components/admin/ledger/row-highlighter";
import {
  buildApprovalBanner,
  describeApprovalFund,
  describePendingCount,
  formatApprovalDollars,
  parseApprovalTab,
  type ApprovalTargetState,
  type DecidedApprovalRow,
} from "@/lib/ledger-approval";
import {
  getRecentDecisions,
  resolveApprovalTarget,
} from "@/lib/ledger-approval-queries";
import type { PendingApprovalRow } from "@/lib/ledger-queries";

export const dynamic = "force-dynamic";

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fundFor(txn: PendingApprovalRow) {
  return describeApprovalFund({
    fundName: txn.fundName,
    partnerFundName: txn.partnerFundName,
    entityId: txn.entityId,
    partnerEntityId: txn.partnerEntityId,
    entityName: txn.entityName,
    partnerEntityName: txn.partnerEntityName,
  });
}

export default async function AdminLedgerApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; txn?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canApprove = await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE);
  if (!canApprove) redirect("/admin/ledger");

  const params = await searchParams;
  const tab = parseApprovalTab(params.tab);
  const txnParam = typeof params.txn === "string" ? params.txn : undefined;
  const currentUserId = session.user.id;

  const [pending, settings] = await Promise.all([
    getPendingApprovals(),
    getSettings(),
  ]);

  // A deep link that cannot be resolved renders no banner; it never blanks the page.
  let target: ApprovalTargetState | null = null;
  if (txnParam) {
    try {
      target = await resolveApprovalTarget(txnParam, currentUserId);
    } catch (err) {
      console.error("Approvals: could not resolve ?txn= target", err);
    }
  }

  // History is fetched only on its own tab, and its failure cannot blank Pending.
  let history: DecidedApprovalRow[] = [];
  let historyFailed = false;
  if (tab === "decided") {
    try {
      history = await getRecentDecisions(currentUserId);
    } catch (err) {
      console.error("Approvals: could not load recent decisions", err);
      historyFailed = true;
    }
  }

  const banner = target ? buildApprovalBanner(target) : null;
  const bannerCosign =
    banner?.action === "cosign" &&
    target?.state === "decided" &&
    target.row.decision === "approved"
      ? cosignDialogProps(target.row, formatApprovalDollars(target.row.amountCents))
      : undefined;
  const targetId =
    target?.state === "pending"
      ? target.rowId
      : target?.state === "decided"
        ? target.row.id
        : undefined;
  // Highlight only a row this tab actually renders.
  const highlightId =
    targetId &&
    ((tab === "pending" && pending.some((p) => p.id === targetId)) ||
      (tab === "decided" && history.some((h) => h.id === targetId)))
      ? targetId
      : undefined;

  const threshold = formatApprovalDollars(settings.disbApprovalThresholdCents);

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
        <h1 className="text-3xl font-bold text-gray-900">Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          {tab === "pending"
            ? `Disbursements over the board approval threshold (${threshold}) require authorization before posting to fund balances.`
            : "The most recent board decisions, newest first."}
        </p>
      </div>

      {/* Deep-link banner: above the tabs so it survives router.refresh() on both tabs. */}
      {banner && <ApprovalBanner model={banner} cosign={bannerCosign} />}

      <ApprovalTabs active={tab} pendingCount={pending.length} />

      {highlightId && (
        <Suspense fallback={null}>
          <RowHighlighter targetId={highlightId} idPrefix="txn-" persistent />
        </Suspense>
      )}

      {tab === "decided" && (
        <ApprovalHistory
          rows={history}
          failed={historyFailed}
          highlightId={highlightId}
        />
      )}

      {/* Badge count */}
      {tab === "pending" && pending.length > 0 && (
        <div className="inline-flex items-center gap-2 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-2">
          <svg
            className="h-4 w-4 text-yellow-600"
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
          <span className="text-sm font-semibold text-yellow-800">
            {describePendingCount(pending.length)}
          </span>
        </div>
      )}

      {/* Empty state */}
      {tab !== "pending" ? null : pending.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          <svg
            className="mx-auto h-10 w-10 text-gray-300 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-lg font-semibold text-gray-700">
            Nothing is waiting for approval
          </p>
          <p className="mt-1 text-sm">
            No pending disbursements. The approval threshold is {threshold}.
          </p>
          <p className="mt-4">
            <Link
              href="/admin/ledger/approvals?tab=decided"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-lions-blue px-5 py-2 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              See recently decided
            </Link>
          </p>
        </div>
      ) : (
        <>
          {/* Below xl: stacked cards. The admin sidebar offset (lg:pl-64), not the
              viewport, is what leaves the table too narrow until 1280px. */}
          <ul className="grid gap-4 md:grid-cols-2 xl:hidden">
            {pending.map((txn) => (
              <ApprovalCard
                key={txn.id}
                transactionId={txn.id}
                dateText={formatDate(txn.txnDate)}
                entityName={txn.entityName}
                highlight={txn.id === highlightId}
                amount={formatApprovalDollars(txn.amountCents)}
                party={txn.party ?? ""}
                memo={txn.memo}
                existingBoardMinute={txn.boardMinute}
                fund={fundFor(txn)}
                recordedBy={txn.recorderName}
                isSelf={txn.recordedByUserId === currentUserId}
              />
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm xl:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Fund
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Payee / Memo
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Recorded by
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {pending.map((txn) => {
                    const isSelf = txn.recordedByUserId === currentUserId;
                    const fund = fundFor(txn);

                    return (
                      <tr
                        key={txn.id}
                        data-row-id={txn.id}
                        tabIndex={txn.id === highlightId ? -1 : undefined}
                        className={`align-top ${
                          txn.id === highlightId
                            ? HIGHLIGHT_CLASSES
                            : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {formatDate(txn.txnDate)}
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-sm">
                          <ApprovalFundLabel
                            fund={fund}
                            entityName={txn.entityName}
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                          {formatApprovalDollars(txn.amountCents)}
                        </td>
                        <td className="max-w-[200px] px-4 py-3 text-sm text-gray-700">
                          {txn.party ? (
                            <div className="break-words font-medium">
                              {txn.party}
                            </div>
                          ) : null}
                          {txn.memo ? (
                            <div className="mt-0.5 break-words text-xs text-gray-500">
                              {txn.memo}
                            </div>
                          ) : null}
                          {!txn.party && !txn.memo && (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {isSelf ? "You" : (txn.recorderName ?? "—")}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ApprovalActions
                            transactionId={txn.id}
                            amount={formatApprovalDollars(txn.amountCents)}
                            party={txn.party ?? ""}
                            memo={txn.memo}
                            existingBoardMinute={txn.boardMinute}
                            fund={fund}
                            recordedBy={txn.recorderName}
                            isSelf={isSelf}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "pending" && (
        <p className="text-xs text-gray-400">
          Transactions become editable only while pending. Once approved, they
          are locked. The approval threshold is currently set to {threshold}{" "}
          (contact the site administrator to change this setting).
        </p>
      )}
    </div>
  );
}
