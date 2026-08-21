"use client";

import Link from "next/link";
import type { AcknowledgmentSummaryRow } from "@/lib/ledger-queries";
import TxnDonorActions from "./txn-donor-actions";

interface SentAckListProps {
  rows: AcknowledgmentSummaryRow[];
  canRecord: boolean;
}

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(d: string): string {
  // txnDate/sentAt come through as YYYY-MM-DD (txnDate) or a Date (sentAt).
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SentViaBadge({ sentVia }: { sentVia: string | null }) {
  if (sentVia === "email") {
    return (
      <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-blue-50 text-lions-blue border border-blue-200">
        Emailed
      </span>
    );
  }
  if (sentVia === "print") {
    return (
      <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
        Printed
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200"
      title="Sent before the send-method column existed — nobody can say today whether it was mailed or printed."
    >
      Unknown
    </span>
  );
}

/**
 * Sent acknowledgments — the "Sent Acknowledgments" tab on
 * /admin/ledger/donors. Companion to AckQueue (pending acks): once an
 * acknowledgment is marked sent it used to vanish from the app entirely
 * (docs/work-log/2026-08-12-sent-acknowledgments-view.md). This view exists
 * so a sent-but-donor-less acknowledgment — which can't produce a letter or
 * feed a 990 Schedule B entry — stays visible and actionable instead of
 * disappearing the moment it's marked sent.
 *
 * Reuses TxnDonorActions (the same Link Donor control used on the fund
 * register) rather than a second implementation — Link Donor PATCHes the
 * underlying transaction's donorId regardless of which screen it's opened
 * from.
 */
export default function SentAckList({ rows, canRecord }: SentAckListProps) {
  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <svg
          className="mx-auto h-12 w-12 text-gray-300 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
        <p className="font-medium">No sent acknowledgments yet</p>
        <p className="mt-1 text-sm">
          Acknowledgments move here once they&rsquo;re marked sent from the Pending tab.
        </p>
      </div>
    );
  }

  const missingDonorCount = rows.filter((r) => !r.donorId).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {rows.length} sent acknowledgment{rows.length !== 1 ? "s" : ""}.
      </p>

      {missingDonorCount > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <svg
            className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-800">
            <span className="font-semibold">
              {missingDonorCount} of {rows.length} sent acknowledgment{rows.length !== 1 ? "s" : ""}
            </span>{" "}
            {missingDonorCount === 1 ? "has" : "have"} no donor linked. An acknowledgment with no
            donor can&rsquo;t produce a letter or feed a 990 Schedule B entry — link a donor below.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Entity / Fund
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Donor
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Sent
                </th>
                {canRecord && (
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Action
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {formatDate(row.txnDate)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <div className="font-medium">{row.entityName}</div>
                    <div className="text-xs text-gray-400">{row.fundName}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {row.donorId ? (
                      <Link
                        href={`/admin/ledger/donors/${row.donorId}`}
                        className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded text-sm"
                      >
                        {row.donorName}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                        No donor linked
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-green-700">
                    +{formatDollars(row.amountCents)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <SentViaBadge sentVia={row.sentVia} />
                  </td>
                  {canRecord && (
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end">
                        <TxnDonorActions
                          txnId={row.donationTxnId}
                          amountCents={row.amountCents}
                          txnDate={row.txnDate}
                          donorId={row.donorId ?? null}
                          ackStatus="sent"
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
