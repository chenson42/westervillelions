import { formatStatementMonth, type LedgerCorrectionRow } from "@/lib/ledger-correction";

/**
 * "Recent corrections" list for the Compliance page (DECISION-110): every move
 * and delete from the last 90 days, who/when/amount/reason, so the board can see
 * corrections to settled money. Server component, presentational, stacked cards
 * (not a table) so it never scrolls sideways at 360px.
 *
 * LEDGER-ONLY: reason text is free text that may name a person. Never import
 * this component (or ledger-audit / ledger-correction) from a member surface;
 * ledger-audit.test.ts enforces it.
 */

interface RecentCorrectionsProps {
  rows: LedgerCorrectionRow[];
  totalInWindow: number;
  /** True when the reader threw; renders a small note instead of failing the page. */
  loadFailed?: boolean;
}

function formatMoney(cents: number): string {
  return `$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatWhen(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "blue" | "red" | "gold" | "gray" }) {
  const tones = {
    blue: "bg-blue-50 text-lions-blue border-blue-100",
    red: "bg-red-50 text-red-700 border-red-100",
    gold: "bg-amber-50 text-amber-800 border-amber-200",
    gray: "bg-gray-100 text-gray-600 border-gray-200",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function RecentCorrections({ rows, totalInWindow, loadFailed }: RecentCorrectionsProps) {
  if (loadFailed) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p className="font-medium">Corrections could not be loaded.</p>
        <p className="mt-1 text-sm">Refresh the page to try again.</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No corrections in the last 90 days.
      </div>
    );
  }

  return (
    <div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={row.kind === "moved" ? "blue" : "red"}>
                {row.kind === "moved" ? "Moved" : "Deleted"}
              </Badge>
              {row.settledPeriod && <Badge tone="gold">Settled period</Badge>}
              {row.sentStatementMonth && (
                <Badge tone="gold">
                  Statement already sent ({formatStatementMonth(row.sentStatementMonth)})
                </Badge>
              )}
              {row.rowCount === 2 && <Badge tone="gray">2 entries</Badge>}
              {row.kind === "moved" && row.crossEntity && (
                <Badge tone="blue">
                  {row.fromEntityName && row.toEntityName
                    ? `${row.fromEntityName} to ${row.toEntityName}`
                    : "Between entities"}
                </Badge>
              )}
              {row.kind === "moved" && row.crossEntity && row.receiptSent && (
                <Badge tone="gold">Receipt already sent</Badge>
              )}
            </div>

            <p className="mt-2 text-sm font-semibold text-gray-900 break-words">
              {row.amountCents != null ? formatMoney(row.amountCents) : "Amount unavailable"}
              {row.flow ? ` ${row.flow}` : ""}
              {row.txnDate ? ` dated ${row.txnDate}` : ""}
              {row.kind === "moved" && row.from && row.to ? (
                <span className="font-normal text-gray-700">
                  {" "}
                  from {row.from} to {row.to}
                </span>
              ) : null}
            </p>

            {row.kind === "moved" && row.crossEntity && (row.fromBankAccount || row.toBankAccount) && (
              <p className="mt-1 text-sm text-gray-700 break-words">
                <span className="font-medium text-gray-900">Bank account:</span>{" "}
                {row.fromBankAccount ?? "none"} to {row.toBankAccount ?? "none"}
              </p>
            )}

            <p className="mt-1 text-sm text-gray-700 break-words whitespace-pre-line">
              <span className="font-medium text-gray-900">Reason:</span>{" "}
              {row.reason ?? "Not recorded (older log entry)."}
            </p>

            <p className="mt-2 text-xs text-gray-500">
              {formatWhen(row.createdAt)} &bull; {row.actorName ?? "Unknown user"}
            </p>
          </li>
        ))}
      </ul>
      {totalInWindow > rows.length && (
        <p className="mt-3 text-sm text-gray-500">
          Showing the {rows.length} most recent of {totalInWindow} in the last 90 days.
        </p>
      )}
    </div>
  );
}
