import { sweepLegMemo, type SweepBatchDetail } from "@/lib/ledger-sweep";
import { formatSweepDate, formatSweepMoney } from "./sweep-builder-logic";

/**
 * What an approver (or anyone who opens a batch) reads about an itemized sweep:
 * the generated memo, count, total, sweep date, the span of the gifts' dates,
 * fiscal years, a line per category, the recorder and the board minute
 * (B-172 Increment 2b, B8). One component for the Approvals card, the table row
 * and the batch dialog.
 *
 * Its props have NO party, memo or donor field and the component reads only the
 * named ones, so an object that carries more (a cast, a wider type) still shows
 * nothing about a person. There is no gift-level list on purpose (proposed B-203).
 */
export type SweepBatchSummaryData = Pick<
  SweepBatchDetail,
  | "count"
  | "totalCents"
  | "sweepDate"
  | "earliestGiftDate"
  | "latestGiftDate"
  | "fiscalYears"
  | "byCategory"
  | "recordedBy"
  | "boardMinute"
>;

export interface SweepBatchSummaryProps {
  data: SweepBatchSummaryData;
  /** The table row has its own Recorded by column. */
  showRecorder?: boolean;
  className?: string;
}

function giftSpan(earliest: string, latest: string): string {
  return earliest === latest
    ? `Gift dated ${formatSweepDate(earliest)}`
    : `Gifts dated ${formatSweepDate(earliest)} to ${formatSweepDate(latest)}`;
}

export default function SweepBatchSummary({ data, showRecorder = true, className }: SweepBatchSummaryProps) {
  const { count, totalCents, sweepDate, earliestGiftDate, latestGiftDate, fiscalYears, byCategory, recordedBy, boardMinute } =
    data;
  return (
    <div className={`space-y-2 text-sm ${className ?? ""}`} data-testid="sweep-batch-summary">
      <p className="break-words font-medium text-gray-900">{sweepLegMemo(count)}</p>
      <p className="text-gray-700">
        {count} {count === 1 ? "gift" : "gifts"}, {formatSweepMoney(totalCents)}. Sweep dated {formatSweepDate(sweepDate)}.
      </p>
      <p className="text-gray-600">
        {giftSpan(earliestGiftDate, latestGiftDate)}
        {fiscalYears.length > 0 ? ` (${fiscalYears.map((y) => `FY${y}`).join(", ")})` : ""}
      </p>
      {byCategory.length > 0 && (
        <ul className="space-y-0.5 text-gray-700" aria-label="Gifts by category">
          {byCategory.map((c, i) => (
            <li key={`${i}-${c.name}`} className="break-words">
              {c.name}: {c.count} {c.count === 1 ? "gift" : "gifts"}, {formatSweepMoney(c.cents)}
            </li>
          ))}
        </ul>
      )}
      {boardMinute ? (
        <p className="break-words text-gray-600">
          <span className="font-medium text-gray-700">Minute:</span> {boardMinute}
        </p>
      ) : null}
      {showRecorder && recordedBy ? <p className="text-gray-500">Recorded by {recordedBy}</p> : null}
    </div>
  );
}
