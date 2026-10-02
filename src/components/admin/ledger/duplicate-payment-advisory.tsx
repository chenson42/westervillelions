import type { CreateFromBankLineCandidate } from "@/lib/ledger-reimbursement-correction";
import { formatCalendarDate } from "@/lib/format-date";
import {
  DIFFERENT_PAYMENT_LABEL,
  candidateHeadline,
  offerInsteadAction,
} from "./create-from-bank-line-logic";

interface DuplicatePaymentAdvisoryProps {
  candidates: readonly CreateFromBankLineCandidate[];
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onUseCandidate: (candidate: CreateFromBankLineCandidate) => void;
  disabled?: boolean;
}

/**
 * The gold advisory shown above the create-from-bank-line form when a paid
 * reimbursement of the same amount may already record this payment. Primary
 * path: "Use that entry instead". Secondary path: tick "This is a different
 * payment", which unlocks Create & Match (B-108 / DECISION-114).
 */
export default function DuplicatePaymentAdvisory({
  candidates,
  acknowledged,
  onAcknowledgedChange,
  onUseCandidate,
  disabled = false,
}: DuplicatePaymentAdvisoryProps) {
  return (
    <section
      role="alert"
      aria-labelledby="cfbl-dup-heading"
      className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800"
    >
      <h3 id="cfbl-dup-heading" className="font-semibold">
        This payment may already be in the register
      </h3>
      <ul className="mt-2 space-y-3">
        {candidates.map((c) => {
          const action = offerInsteadAction(c);
          return (
            <li key={c.transactionId} className="space-y-2">
              <p className="break-words">
                {candidateHeadline(c, (d) => formatCalendarDate(d))} may already record this
                payment. Creating a new entry would count it twice.
                {c.checkNumberMatchesLine && (
                  <span className="font-semibold"> Check numbers match.</span>
                )}
                {c.needsBankAccount && (
                  <span className="text-gray-600">
                    {" "}
                    It has no bank account yet, so it has to be repaired before it can be matched.
                  </span>
                )}
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => onUseCandidate(c)}
                  disabled={disabled || action.disabledReason !== null}
                  aria-describedby={action.disabledReason ? `cfbl-dup-own-${c.transactionId}` : undefined}
                  className="bg-lions-blue text-white px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
                >
                  Use that entry instead
                </button>
                {action.disabledReason && (
                  <p id={`cfbl-dup-own-${c.transactionId}`} className="mt-1 text-xs text-gray-600">
                    {action.disabledReason}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <label className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
          disabled={disabled}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
        />
        <span>
          {DIFFERENT_PAYMENT_LABEL}
          <span className="block text-xs text-gray-600">
            Tick this to create a new entry anyway.
          </span>
        </span>
      </label>
    </section>
  );
}
