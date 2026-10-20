"use client";

import CorrectionReasonField from "./correction-reason-field";
import {
  BOARD_MINUTE_MAX_LEN,
  describeBankDifference,
  describeFoundationReceipt,
  formatSweepDate,
  formatSweepMoney,
  sweepTierLine,
} from "./sweep-builder-logic";
import { fiscalYearLabel } from "@/lib/fiscal-year";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  REASON_LIMITS,
  SWEEP_ERROR_COPY,
  SWEEP_INT4_MAX,
  SWEEP_ROW_FLAG_COPY,
  SWEEP_ROW_REFUSAL_COPY,
  describeSentStatementMonth,
  describeSweepWarning,
  type SweepPreviewResponse,
} from "@/lib/ledger-sweep";

export interface SweepAccountOption {
  id: string;
  label: string;
}

export interface SweepReviewPanelProps {
  labels: FundLabels;
  preview: SweepPreviewResponse | null;
  loading: boolean;
  /** A preview that could not be produced (shown instead of the list). */
  loadError: string | null;
  /** An inline notice after a refused or drifted Post. */
  notice: string | null;
  sweepDate: string;
  today: string;
  onSweepDateChange: (value: string) => void;
  sourceAccounts: SweepAccountOption[];
  destAccounts: SweepAccountOption[];
  sourceAccountId: string;
  destAccountId: string;
  onSourceAccountChange: (id: string) => void;
  onDestAccountChange: (id: string) => void;
  bankAmountText: string;
  typedCents: number | null;
  onBankAmountChange: (value: string) => void;
  boardMinute: string;
  onBoardMinuteChange: (value: string) => void;
  priorYearReason: string;
  onReasonChange: (value: string) => void;
  submitting: boolean;
  canPostNow: boolean;
  onBack: () => void;
  onPost: () => void;
  onLeaveOutRefused: () => void;
}

const inputClass =
  "block w-full min-h-[44px] rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60";
const primaryButton =
  "bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";
const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";

export default function SweepReviewPanel(props: SweepReviewPanelProps) {
  const { preview, labels } = props;
  const tier = preview ? sweepTierLine(preview) : null;
  const refusedRows = preview ? preview.rows.filter((r) => r.refusal !== null) : [];
  const accepted = preview ? preview.rows.filter((r) => r.refusal === null) : [];
  const tooLarge = preview ? preview.totalCents > SWEEP_INT4_MAX : false;
  const difference = preview ? describeBankDifference(preview.totalCents, props.typedCents) : null;
  const bankInvalid = props.bankAmountText.trim() !== "" && props.typedCents === null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white shadow-sm p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Review the sweep</h2>

        {props.loading && !preview && (
          <p role="status" className="text-sm text-gray-600">
            Checking the gifts…
          </p>
        )}

        {props.loadError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {props.loadError}
          </p>
        )}

        {props.notice && (
          <p role="alert" className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800">
            {props.notice}
          </p>
        )}

        {preview && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-gray-500">Gifts</dt>
                <dd className="font-semibold text-gray-900">{preview.count}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Total</dt>
                <dd className="font-semibold text-gray-900 tabular-nums">{formatSweepMoney(preview.totalCents)}</dd>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-gray-500">Fiscal years</dt>
                <dd className="font-semibold text-gray-900">
                  {preview.fiscalYears.length === 0
                    ? "None"
                    : preview.fiscalYears.map((fy) => fiscalYearLabel(fy).split(" ")[0]).join(", ")}
                </dd>
              </div>
            </dl>

            {tooLarge && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {SWEEP_ERROR_COPY.total_too_large(labels)}
              </p>
            )}

            {refusedRows.length > 0 && (
              <div role="alert" className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800 space-y-2">
                <p className="font-semibold">
                  {refusedRows.length === 1
                    ? "One selected gift cannot be swept."
                    : `${refusedRows.length} selected gifts cannot be swept.`}
                </p>
                <ul className="space-y-1">
                  {refusedRows.map((r) => (
                    <li key={r.sourceId}>
                      <span className="font-medium">
                        {r.party?.trim() || "No payer recorded"}, {formatSweepDate(r.giftDate)}, {formatSweepMoney(r.amountCents)}:
                      </span>{" "}
                      {SWEEP_ROW_REFUSAL_COPY[r.refusal!](labels)}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={props.onLeaveOutRefused} className={secondaryButton}>
                  Leave those gifts out
                </button>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <ul className="space-y-2" aria-label="Things to know">
                {preview.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                    {describeSweepWarning(w, labels)}
                  </li>
                ))}
              </ul>
            )}

            {preview.sentStatementMonths.length > 0 && (
              <div className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800">
                <p className="font-semibold">A monthly statement was already sent for:</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.sentStatementMonths.map((m) => (
                    <li key={m.month}>{describeSentStatementMonth(m)}</li>
                  ))}
                </ul>
              </div>
            )}

            {tier && (
              <div className="rounded-lg bg-lions-blue/5 p-3 text-sm text-gray-800 space-y-1">
                <p>{tier.statusLine}</p>
                {tier.tierLine && <p>{tier.tierLine}</p>}
              </div>
            )}

            {accepted.length > 0 && (
              <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200" aria-label="Gifts in this sweep">
                {accepted.map((r) => (
                  <li key={r.sourceId} className="p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="font-medium text-gray-900 break-words">
                        {r.party?.trim() || "No payer recorded"}
                      </span>
                      <span className="font-semibold tabular-nums text-gray-900">{formatSweepMoney(r.amountCents)}</span>
                    </div>
                    <p className="text-gray-600">
                      Gift of {formatSweepDate(r.giftDate)}
                      {r.categoryName ? `, ${r.categoryName}` : ""}
                      {r.foundationCategoryName ? ` → ${r.foundationCategoryName}` : ""}
                    </p>
                    <p className="text-xs text-gray-600">
                      {describeFoundationReceipt(r.foundationReceipt, r.receiptSentOn)}
                    </p>
                    {r.flags.map((f) => (
                      <p key={f} className="text-xs text-gray-700">
                        {SWEEP_ROW_FLAG_COPY[f](labels)}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <form
        className="rounded-2xl bg-white shadow-sm p-4 sm:p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (props.canPostNow && !props.submitting) props.onPost();
        }}
      >
        <h2 className="text-lg font-semibold text-gray-900">Record the sweep</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sweep-date" className="block text-sm font-medium text-gray-700 mb-1">
              Sweep date
            </label>
            <input
              id="sweep-date"
              type="date"
              value={props.sweepDate}
              max={props.today}
              required
              disabled={props.submitting}
              onChange={(e) => props.onSweepDateChange(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-500">The day the money moved. It cannot be in the future.</p>
          </div>
          <div>
            <label htmlFor="sweep-bank-amount" className="block text-sm font-medium text-gray-700 mb-1">
              Amount that reached the bank
            </label>
            <input
              id="sweep-bank-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={props.bankAmountText}
              disabled={props.submitting}
              onChange={(e) => props.onBankAmountChange(e.target.value)}
              placeholder="0.00"
              aria-describedby="sweep-bank-amount-help"
              className={inputClass}
            />
            <p id="sweep-bank-amount-help" className="mt-1 text-xs text-gray-500">
              {bankInvalid
                ? "Enter dollars and cents, for example 1,234.56."
                : (difference ?? "It must equal the total of the selected gifts.")}
            </p>
          </div>
          <div>
            <label htmlFor="sweep-source-account" className="block text-sm font-medium text-gray-700 mb-1">
              From account
            </label>
            <select
              id="sweep-source-account"
              value={props.sourceAccountId}
              disabled={props.submitting}
              onChange={(e) => props.onSourceAccountChange(e.target.value)}
              className={inputClass}
            >
              {props.sourceAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sweep-dest-account" className="block text-sm font-medium text-gray-700 mb-1">
              To account
            </label>
            <select
              id="sweep-dest-account"
              value={props.destAccountId}
              disabled={props.submitting}
              onChange={(e) => props.onDestAccountChange(e.target.value)}
              className={inputClass}
            >
              {props.destAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="sweep-board-minute" className="block text-sm font-medium text-gray-700 mb-1">
            Board-minute reference <span className="text-red-600" aria-hidden="true">*</span>
            <span className="sr-only"> (required)</span>
          </label>
          <input
            id="sweep-board-minute"
            type="text"
            value={props.boardMinute}
            maxLength={BOARD_MINUTE_MAX_LEN}
            disabled={props.submitting}
            onChange={(e) => props.onBoardMinuteChange(e.target.value)}
            placeholder="e.g., Motion passed at the October meeting"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">The board meeting minute or motion that authorized this sweep.</p>
        </div>

        {preview && preview.count > 0 && preview.needsReason && (
          <CorrectionReasonField
            id="sweep-prior-year-reason"
            value={props.priorYearReason}
            onChange={props.onReasonChange}
            min={REASON_LIMITS.min}
            max={REASON_LIMITS.max}
            disabled={props.submitting}
            label="Reason for sweeping an earlier fiscal year"
            helpText="Why are these gifts being swept now? Do not type a donor's name."
          />
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:items-center">
          {props.submitting && (
            <p role="status" className="text-sm text-gray-600 sm:mr-auto">
              This can take up to half a minute while the board is told.
            </p>
          )}
          <button type="button" onClick={props.onBack} disabled={props.submitting} className={secondaryButton}>
            Back to the list
          </button>
          <button type="submit" disabled={!props.canPostNow || props.submitting} className={primaryButton}>
            {props.submitting ? "Posting…" : "Post sweep"}
          </button>
        </div>
      </form>
    </div>
  );
}
