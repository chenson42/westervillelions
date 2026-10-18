import { mirrorHintCopy, type MirrorHint } from "@/lib/ledger-category-mirror";
import type { FundLabels } from "@/lib/ledger-fund-labels";

interface FoundationBoundHintProps {
  hint: MirrorHint;
  labels: FundLabels;
}

/**
 * One line under the Category field when a Public Funds income gift is keyed:
 * bound for the Foundation (with the receipt note) or staying in Public Funds.
 * Pure presentation of `describeMirrorHint()`; the copy lives in
 * `mirrorHintCopy()` (exhaustive switch). Renders nothing when not applicable.
 */
export default function FoundationBoundHint({ hint, labels }: FoundationBoundHintProps) {
  const copy = mirrorHintCopy(hint, labels);
  if (!copy) return null;
  const bound = hint.state === "bound";
  return (
    <p
      role="note"
      data-hint-state={hint.state}
      className={`mt-2 rounded-lg px-3 py-2 text-xs ${
        bound ? "bg-blue-50 border border-blue-100 text-blue-800" : "bg-gray-50 border border-gray-200 text-gray-600"
      }`}
    >
      {copy}
    </p>
  );
}
