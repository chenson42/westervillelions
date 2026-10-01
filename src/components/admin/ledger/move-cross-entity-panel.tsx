import MoveImpactCard from "./move-impact-card";
import { formatMoneyCents } from "./correction-dialog-logic";
import {
  UNSENT_RECEIPT_REMOVED_WARNING,
  type MoveDestination,
  type MovePreview,
} from "@/lib/ledger-correction";

const fieldClass =
  "w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60";

interface MoveCrossEntityPanelProps {
  destination: MoveDestination;
  /** The row being moved (for the receipt state and the source entity's name). */
  transaction: MovePreview["transaction"];
  /** The picked destination bank account id, "" when none is picked. */
  bankAccountId: string;
  disabled: boolean;
  onBankAccountChange: (id: string) => void;
}

/**
 * The part of the Move dialog that exists only when the money crosses from one
 * entity to the other: the explicit destination bank-account pick, the
 * before-and-after rows for both entities' bank accounts, the receipt line, and
 * the advisory list of entries that might already record the same deposit.
 * Presentational and server-safe: state in, events out.
 */
export default function MoveCrossEntityPanel({
  destination,
  transaction,
  bankAccountId,
  disabled,
  onBankAccountChange,
}: MoveCrossEntityPanelProps) {
  const options = destination.bankAccounts ?? [];
  const picked = options.find((o) => o.id === bankAccountId) ?? null;
  const impact = destination.impact && destination.impact.crossEntity ? destination.impact : null;
  const sourceBank = impact?.sourceBankAccount ?? null;
  const duplicates = destination.duplicateCandidates ?? [];
  const entityName = destination.entity.name;
  const sourceEntityName = transaction.entity.name;

  const unsentLine =
    destination.warnings?.find((w) => w.code === "unsent_receipt_removed")?.message ??
    UNSENT_RECEIPT_REMOVED_WARNING;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="move-bank" className="block text-sm font-medium text-gray-700 mb-1">
          {entityName} bank account
        </label>
        <select
          id="move-bank"
          value={bankAccountId}
          onChange={(e) => onBankAccountChange(e.target.value)}
          disabled={disabled}
          required
          aria-describedby="move-bank-help"
          className={fieldClass}
        >
          <option value="">Choose an account&hellip;</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <p id="move-bank-help" className="mt-1 text-xs text-gray-500">
          Pick the account the money actually landed in.
        </p>
      </div>

      <section aria-labelledby="move-bank-impact-heading">
        <h3 id="move-bank-impact-heading" className="text-sm font-semibold text-gray-900 mb-2">
          Bank accounts change too
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sourceBank ? (
            <MoveImpactCard
              heading={`Leaves ${sourceEntityName} account`}
              name={sourceBank.name}
              beforeCents={sourceBank.beforeCents}
              afterCents={sourceBank.afterCents}
              caption="book balance"
            />
          ) : (
            <div className="rounded-2xl bg-gray-50 p-3 text-sm text-gray-600">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Leaves {sourceEntityName} account
              </p>
              <p className="mt-1">This entry is not on a {sourceEntityName} bank account.</p>
            </div>
          )}
          {picked ? (
            <MoveImpactCard
              heading={`Arrives in ${entityName} account`}
              name={picked.name}
              beforeCents={picked.beforeCents}
              afterCents={picked.afterCents}
              caption="book balance"
            />
          ) : (
            <div className="rounded-2xl bg-gray-50 p-3 text-sm text-gray-600">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Arrives in {entityName} account
              </p>
              <p className="mt-1">Choose an account to see its balance change.</p>
            </div>
          )}
        </div>
      </section>

      {transaction.receipt === "sent" && (
        <p role="note" className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          <span className="font-semibold">
            The {sourceEntityName}&rsquo;s receipt stays with this gift.
          </span>{" "}
          The receipt letter already sent for it stays attached, and the donor stays linked.
        </p>
      )}
      {transaction.receipt === "unsent" && (
        <p role="note" className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          {unsentLine}
        </p>
      )}

      {duplicates.length > 0 && (
        <section aria-labelledby="move-duplicates-heading">
          <h3 id="move-duplicates-heading" className="text-sm font-semibold text-gray-900">
            Possibly the same deposit
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Advisory only. These {entityName} entries have the same amount within 30 days of this
            gift.
          </p>
          <ul className="mt-2 space-y-2">
            {duplicates.map((d) => (
              <li key={d.id} className="rounded-2xl bg-gray-50 p-3 text-sm">
                <p className="font-medium text-gray-900 break-words">
                  {d.txnDate} &middot; {d.party ?? "(no party)"} &middot;{" "}
                  <span className="tabular-nums">+{formatMoneyCents(d.amountCents)}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                  <span className="break-words">
                    {d.fundName}
                    {d.bankAccountName ? ` · ${d.bankAccountName}` : ""}
                  </span>
                  {d.matched && (
                    <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 font-semibold text-lions-blue">
                      Matched
                    </span>
                  )}
                  {d.reconciled && (
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                      Reconciled
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
