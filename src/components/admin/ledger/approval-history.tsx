import Link from "next/link";
import {
  RECENT_DECISIONS_LIMIT,
  describeApprovalFund,
  formatApprovalDollars,
  formatDecisionDateTime,
  type DecidedApprovalRow,
} from "@/lib/ledger-approval";
import ApprovalFundLabel from "./approval-fund-label";
import { COSIGN_HELP_LINE, cosignDialogProps, cosignerItems } from "./approval-dialog-logic";
import CosignDialog from "./cosign-dialog";
import { HIGHLIGHT_CLASSES } from "./approval-highlight";

/** "Approved by Sam" / "Rejected by You" / "Rejected, decider not on file". */
export function deciderLabel(row: DecidedApprovalRow): string {
  const verb = row.decision === "approved" ? "Approved" : "Rejected";
  if (row.decision === "rejected" && !row.deciderOnFile && !row.deciderIsViewer) {
    return "Rejected, decider not on file";
  }
  if (row.deciderIsViewer) return `${verb} by You`;
  return `${verb} by ${row.deciderName ?? "a board member"}`;
}

/**
 * Recently decided: the last RECENT_DECISIONS_LIMIT board decisions, one card
 * per decision at every width (the minute and reason are long free text, so
 * there is no table). Visible to `ledger.approve` holders only; the page
 * enforces that. `data-row-id`, never `id`, like the pending list.
 */
export default function ApprovalHistory({
  rows,
  failed = false,
  highlightId,
}: {
  rows: DecidedApprovalRow[];
  failed?: boolean;
  highlightId?: string;
}) {
  if (failed) {
    return (
      <div className="rounded-2xl bg-gray-50 p-10 text-center text-gray-500">
        <p className="font-medium text-gray-700">
          Could not load recent decisions. Try again in a moment.
        </p>
        <p className="mt-3">
          <Link
            href="/admin/ledger/approvals?tab=decided"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-lions-blue px-5 py-2 text-sm font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Try again
          </Link>
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-gray-50 p-10 text-center text-gray-500">
        <p className="text-lg font-semibold text-gray-700">
          No disbursements have been approved or rejected yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">{COSIGN_HELP_LINE}</p>
      <ul className="space-y-4">
        {rows.map((row) => {
          const fund = describeApprovalFund({
            fundName: row.fundName,
            partnerFundName: row.partnerFundName,
            entityId: row.entityId,
            partnerEntityId: row.partnerEntityId,
            entityName: row.entityName,
            partnerEntityName: row.partnerEntityName,
          });
          const highlighted = row.id === highlightId;
          const approved = row.decision === "approved";
          return (
            <li
              key={row.id}
              data-row-id={row.id}
              tabIndex={highlighted ? -1 : undefined}
              className={`space-y-3 overflow-hidden rounded-2xl p-4 shadow-sm ${
                highlighted ? HIGHLIGHT_CLASSES : "bg-white"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <p className="text-2xl font-bold tabular-nums text-gray-900">
                  {formatApprovalDollars(row.amountCents)}
                </p>
                <span
                  className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    approved ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {approved ? "Approved" : "Rejected"}
                </span>
              </div>

              {(row.party || row.memo) && (
                <div className="text-sm">
                  {row.party ? (
                    <p className="break-words font-medium text-gray-900">{row.party}</p>
                  ) : null}
                  {row.memo ? <p className="mt-0.5 break-words text-gray-600">{row.memo}</p> : null}
                </div>
              )}

              <div className="text-sm">
                <ApprovalFundLabel fund={fund} entityName={row.entityName} />
              </div>

              <p className="text-sm text-gray-500">
                Recorded by{" "}
                <span className="text-gray-700">{row.recorderName ?? "an unknown user"}</span>
              </p>

              <p className="text-sm text-gray-700">
                <span className="font-medium">{deciderLabel(row)}</span>
                {formatDecisionDateTime(row.decidedAt) ? (
                  <span className="text-gray-500"> · {formatDecisionDateTime(row.decidedAt)}</span>
                ) : null}
              </p>

              {row.decision === "approved" && cosignerItems(row.cosigners).length > 0 ? (
                <p className="break-words text-sm text-gray-700">
                  <span className="font-medium">Also approved by:</span>{" "}
                  {cosignerItems(row.cosigners).join(", ")}
                </p>
              ) : null}

              {row.decision === "approved" && row.viewerRecorded ? (
                <p className="text-sm text-gray-500">
                  You recorded this, so another board member decides it.
                </p>
              ) : null}

              {row.decision === "approved" && row.viewerHasCosigned ? (
                <p className="text-sm font-medium text-green-800">You added your approval.</p>
              ) : null}

              {row.decision === "approved" ? (
                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Board minute
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">
                    {row.boardMinute}
                  </p>
                </div>
              ) : row.rejectionReason ? (
                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Reason
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-gray-800">
                    {row.rejectionReason}
                  </p>
                </div>
              ) : null}

              {row.decision === "approved" && row.canCosign ? (
                <div className="sm:max-w-xs">
                  <CosignDialog {...cosignDialogProps(row, formatApprovalDollars(row.amountCents))} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-gray-500">
        Showing the {RECENT_DECISIONS_LIMIT} most recent decisions. For older entries, use the{" "}
        <Link
          href="/admin/ledger"
          className="rounded text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          Ledger register
        </Link>{" "}
        or{" "}
        <Link
          href="/admin/ledger/search"
          className="rounded text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue"
        >
          search
        </Link>
        .
      </p>
    </div>
  );
}
