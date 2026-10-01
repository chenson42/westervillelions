import { formatMoneyCents } from "./correction-dialog-logic";

interface MoveImpactCardProps {
  /** Small label above the name, e.g. "Leaves" or "Arrives in account". */
  heading: string;
  name: string;
  beforeCents: number;
  afterCents: number;
  /** What the balance is, e.g. "all-time balance". */
  caption: string;
}

/**
 * One before-and-after balance card in the Move dialog's "What will change"
 * panel. Used for funds and, on a cross-entity move, for both bank accounts, so
 * every row looks the same and the bank rows are as prominent as the fund rows.
 */
export default function MoveImpactCard({
  heading,
  name,
  beforeCents,
  afterCents,
  caption,
}: MoveImpactCardProps) {
  return (
    <div className="rounded-2xl bg-gray-50 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{heading}</p>
      <p className="text-sm font-semibold text-gray-900 break-words">{name}</p>
      <p className="mt-1 text-sm text-gray-700 tabular-nums">
        {formatMoneyCents(beforeCents)} <span aria-hidden="true">&rarr;</span>
        <span className="sr-only"> becomes </span>{" "}
        <span className="font-semibold">{formatMoneyCents(afterCents)}</span>
      </p>
      <p className="text-xs text-gray-500">{caption}</p>
    </div>
  );
}
