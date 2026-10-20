import { DEFAULT_FUND_LABELS, type FundLabels } from "@/lib/ledger-fund-labels";
import { sweepChipLabel, type SweepRowBadge } from "@/lib/ledger-sweep";

/**
 * The register chip for a row that plays a part in an itemized sweep (B-172
 * Increment 2b, B11): "Sweep of N gifts to the Foundation", "Swept from {fund}
 * on D" or "Swept to the Foundation on D", state-qualified. The words come from
 * the carrier; the fund's stored name arrives as `labels`. A chip, so
 * `rounded-full` is allowed; it is not a control (the Batch button is).
 */
export default function SweepRowChip({
  badge,
  labels = DEFAULT_FUND_LABELS,
}: {
  badge: SweepRowBadge;
  labels?: FundLabels;
}) {
  const rejected = badge.state === "rejected";
  return (
    <span
      data-sweep-chip={badge.kind}
      className={`mt-1 inline-flex max-w-full items-center whitespace-normal break-words rounded-full px-2.5 py-0.5 text-xs font-medium ${
        rejected ? "bg-gray-100 text-gray-500" : "bg-lions-blue/10 text-lions-blue"
      }`}
    >
      {sweepChipLabel(badge, labels)}
    </span>
  );
}
