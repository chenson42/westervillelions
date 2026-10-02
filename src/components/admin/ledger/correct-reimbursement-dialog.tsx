"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LedgerDialogShell from "./ledger-dialog-shell";
import CorrectionReasonField from "./correction-reason-field";
import BudgetLinePicker from "./budget-line-picker";
import { formatMoneyCents } from "./correction-dialog-logic";
import {
  BUDGET_LINE_CLEARED_MESSAGE,
  CORRECT_MODE_COPY,
  applyValuePatch,
  buildCorrectBody,
  changesFromValues,
  correctBlockReason,
  correctFailureAction,
  correctSuccessMessage,
  initialCorrectValues,
  initialFillBankAccountId,
  proposalQuery,
  resolveCorrectClose,
  storedValuesOf,
  visibleWarnings,
  type CorrectFormValues,
  type CorrectMode,
} from "./correct-reimbursement-dialog-logic";
import {
  CORRECTION_FAILED_MESSAGE,
  type CorrectionErrorBody,
  type CorrectionPreview,
  type CorrectionWarning,
  type CorrectResponse,
} from "@/lib/ledger-reimbursement-correction";
import {
  CHECK_NUMBER_MAX_LEN,
  REIMBURSEMENT_PAYMENT_METHOD_LABELS,
} from "@/lib/ledger";
import { getFiscalYear } from "@/lib/fiscal-year";

export type CorrectDialogPhase =
  | { phase: "loading" }
  | { phase: "load_error"; message: string }
  | { phase: "blocked"; message: string }
  | { phase: "form"; preview: CorrectionPreview }
  | { phase: "success"; result: CorrectResponse };

/** The server's evaluation of the proposed date and method (warnings, refusal). */
export interface CorrectProposalState {
  warnings: CorrectionWarning[];
  denial: { code: string; reason: string } | null;
}

const primaryButton =
  "bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";
const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";
const fieldClass =
  "w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:bg-gray-50 disabled:opacity-60";

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="text-gray-500 sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="text-gray-900 break-words">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational body (state in, events out): every phase renders DOM-less.
// ---------------------------------------------------------------------------

export interface CorrectDialogBodyProps {
  state: CorrectDialogPhase;
  mode: CorrectMode;
  values: CorrectFormValues;
  reason: string;
  submitting: boolean;
  inlineError: string | null;
  proposal: CorrectProposalState;
  /** The budget-line link was dropped because the category or date moved it out of range. */
  budgetLineCleared: boolean;
  onValueChange: (patch: Partial<CorrectFormValues>) => void;
  onReasonChange: (reason: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDone: () => void;
  onRetryLoad: () => void;
}

export function CorrectDialogBody(props: CorrectDialogBodyProps) {
  const { state, mode } = props;
  const copy = CORRECT_MODE_COPY[mode];

  if (state.phase === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3 animate-pulse">
        <span className="sr-only">Loading this entry</span>
        <div className="h-24 rounded-2xl bg-gray-100" />
        <div className="h-11 rounded-lg bg-gray-100" />
        <div className="h-11 rounded-lg bg-gray-100" />
      </div>
    );
  }

  if (state.phase === "load_error") {
    return (
      <div>
        <div role="alert" className="bg-gray-50 rounded-2xl p-6 text-center text-gray-600">
          <p className="font-semibold text-gray-700">Couldn&rsquo;t load this entry</p>
          <p className="mt-1 text-sm">{state.message}</p>
        </div>
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={props.onCancel} className={secondaryButton}>
            Close
          </button>
          <button type="button" onClick={props.onRetryLoad} className={primaryButton}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "blocked") {
    return (
      <div>
        <div role="alert" className="bg-gray-50 rounded-2xl p-6 text-gray-700 text-sm">
          <p className="font-semibold">{copy.blockedHeading}</p>
          <p className="mt-1">{state.message}</p>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={props.onCancel} className={secondaryButton}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "success") {
    return (
      <div>
        <div role="status" className="rounded-2xl bg-green-50 p-4 text-green-900">
          <p className="font-semibold">{correctSuccessMessage(state.result)}</p>
          {state.result.budgetLineLinkCleared && (
            <p className="mt-1 text-sm">{BUDGET_LINE_CLEARED_MESSAGE}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={props.onDone} className={secondaryButton}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // phase === "form"
  const { preview } = state;
  const tx = preview.transaction;
  const stored = storedValuesOf(tx);
  const correctOp = preview.operations.correct;
  const dateAndBankEditable = correctOp.dateAndBankEditable;
  const lockedMessage = correctOp.lockedFields?.message ?? null;
  const { changed } = changesFromValues(stored, props.values);
  const warnings = mode === "correct" ? visibleWarnings(props.proposal.warnings, changed) : [];
  const blockReason = correctBlockReason({
    mode,
    stored,
    values: props.values,
    reason: props.reason,
    reasonMin: preview.reasonLimits.min,
    reasonMax: preview.reasonLimits.max,
    denied: props.proposal.denial !== null,
  });
  const noAccounts = preview.options.bankAccounts.length === 0;
  const showCheckNumber =
    mode === "add_bank_account" ? !tx.checkNumber : props.values.paymentMethod === "check";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!blockReason && !props.submitting) props.onSubmit();
      }}
      className="space-y-4"
    >
      <dl className="rounded-2xl bg-gray-50 p-3 space-y-1.5 text-sm">
        <SummaryRow label="Date" value={tx.txnDate} />
        <SummaryRow label="Paid to" value={tx.party ?? "(no party)"} />
        <SummaryRow label="Amount" value={`-${formatMoneyCents(tx.amountCents)}`} />
        <SummaryRow label="Fund" value={`${tx.fundName} (${tx.entity.name})`} />
        <SummaryRow label="Bank account" value={tx.bankAccountName ?? "None yet"} />
        {mode === "add_bank_account" && (
          <SummaryRow label="Description" value={tx.memo ?? "(none)"} />
        )}
      </dl>

      {mode === "add_bank_account" ? (
        <>
          <div>
            <label htmlFor="correct-bank" className="block text-sm font-medium text-gray-700 mb-1">
              Bank account <span className="text-red-600" aria-hidden="true">*</span>
              <span className="sr-only"> (required)</span>
            </label>
            {noAccounts ? (
              <p role="alert" className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800">
                Add a bank account for {tx.entity.name} in Ledger settings first.
              </p>
            ) : (
              <select
                id="correct-bank"
                value={props.values.bankAccountId}
                onChange={(e) => props.onValueChange({ bankAccountId: e.target.value })}
                disabled={props.submitting}
                required
                aria-describedby="correct-bank-help"
                className={fieldClass}
              >
                <option value="">Select bank account&hellip;</option>
                {preview.options.bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <p id="correct-bank-help" className="mt-1 text-xs text-gray-500">
              The account the money came out of. Once it is added, the payment can be matched to its
              bank line in reconciliation.
            </p>
          </div>
          {showCheckNumber && (
            <div>
              <label htmlFor="correct-check" className="block text-sm font-medium text-gray-700 mb-1">
                Check number <span className="text-gray-400 font-normal text-xs">(optional)</span>
              </label>
              <input
                id="correct-check"
                type="text"
                value={props.values.checkNumber}
                onChange={(e) => props.onValueChange({ checkNumber: e.target.value })}
                maxLength={CHECK_NUMBER_MAX_LEN}
                disabled={props.submitting}
                placeholder="e.g., 8249"
                className={fieldClass}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <label htmlFor="correct-category" className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <select
              id="correct-category"
              value={props.values.categoryId}
              onChange={(e) => props.onValueChange({ categoryId: e.target.value })}
              disabled={props.submitting}
              className={fieldClass}
            >
              {!props.values.categoryId && <option value="">Select category&hellip;</option>}
              {preview.options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <BudgetLinePicker
            id="correct-budget-line"
            budgetLines={preview.options.budgetLines.filter(
              (l) => l.categoryId === props.values.categoryId,
            )}
            fundId={tx.fundId}
            txnDate={props.values.txnDate}
            value={props.values.budgetLineId}
            onSelect={(line) => props.onValueChange({ budgetLineId: line?.id ?? "" })}
            disabled={props.submitting || !props.values.categoryId}
          />
          {props.budgetLineCleared && (
            <p role="status" className="-mt-2 text-xs text-gray-600">
              {BUDGET_LINE_CLEARED_MESSAGE}
            </p>
          )}

          <div>
            <label htmlFor="correct-date" className="block text-sm font-medium text-gray-700 mb-1">
              Payment date
            </label>
            <input
              id="correct-date"
              type="date"
              value={props.values.txnDate}
              onChange={(e) => props.onValueChange({ txnDate: e.target.value })}
              disabled={props.submitting || !dateAndBankEditable}
              aria-describedby={!dateAndBankEditable ? "correct-locked" : undefined}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="correct-bank" className="block text-sm font-medium text-gray-700 mb-1">
              Bank account
            </label>
            <select
              id="correct-bank"
              value={props.values.bankAccountId}
              onChange={(e) => props.onValueChange({ bankAccountId: e.target.value })}
              disabled={props.submitting || !dateAndBankEditable}
              aria-describedby={!dateAndBankEditable ? "correct-locked" : "correct-bank-help"}
              className={fieldClass}
            >
              {!props.values.bankAccountId && <option value="">None yet</option>}
              {preview.options.bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {dateAndBankEditable && (
              <p id="correct-bank-help" className="mt-1 text-xs text-gray-500">
                Changing the account moves this payment between the two accounts&rsquo; book balances.
              </p>
            )}
          </div>
          {!dateAndBankEditable && lockedMessage && (
            <p id="correct-locked" role="note" className="-mt-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
              <span className="font-semibold">Date and bank account are locked.</span> {lockedMessage}
            </p>
          )}

          <div>
            <label htmlFor="correct-method" className="block text-sm font-medium text-gray-700 mb-1">
              Payment method
            </label>
            <select
              id="correct-method"
              value={props.values.paymentMethod}
              onChange={(e) => props.onValueChange({ paymentMethod: e.target.value })}
              disabled={props.submitting}
              className={fieldClass}
            >
              {!props.values.paymentMethod && <option value="">Select method&hellip;</option>}
              {preview.options.paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {REIMBURSEMENT_PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          {showCheckNumber && (
            <div>
              <label htmlFor="correct-check" className="block text-sm font-medium text-gray-700 mb-1">
                Check number <span className="text-gray-400 font-normal text-xs">(optional; clear it to remove)</span>
              </label>
              <input
                id="correct-check"
                type="text"
                value={props.values.checkNumber}
                onChange={(e) => props.onValueChange({ checkNumber: e.target.value })}
                maxLength={CHECK_NUMBER_MAX_LEN}
                disabled={props.submitting}
                placeholder="e.g., 8249"
                className={fieldClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="correct-memo" className="block text-sm font-medium text-gray-700 mb-1">
              Register description
            </label>
            <textarea
              id="correct-memo"
              value={props.values.memo}
              onChange={(e) => props.onValueChange({ memo: e.target.value })}
              maxLength={1000}
              rows={3}
              disabled={props.submitting}
              className={`${fieldClass} min-h-[88px]`}
            />
          </div>

          <CorrectionReasonField
            id="correct-reason"
            value={props.reason}
            onChange={props.onReasonChange}
            min={preview.reasonLimits.min}
            max={preview.reasonLimits.max}
            disabled={props.submitting}
            helpText="For example: the check number was entered in the description by mistake."
          />
        </>
      )}

      {props.proposal.denial && (
        <p role="alert" className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800">
          {props.proposal.denial.reason}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600" aria-label="Things to know before saving">
          {warnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      )}

      {props.inlineError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {props.inlineError}
        </p>
      )}

      {blockReason && mode === "correct" && props.reason.trim() === "" && changed.length > 0 && (
        <p className="text-xs text-gray-500">{blockReason}</p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={props.onCancel} disabled={props.submitting} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={Boolean(blockReason) || props.submitting} className={primaryButton}>
          {props.submitting ? copy.submitting : copy.submit}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Stateful dialog
// ---------------------------------------------------------------------------

interface CorrectReimbursementDialogProps {
  transactionId: string;
  mode: CorrectMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Add bank account: the account to start on (the open reconciliation session's). */
  preselectBankAccountId?: string | null;
  /** Called after a successful save, once the dialog has closed (before refresh). */
  onSaved?: () => void;
}

const EMPTY_VALUES: CorrectFormValues = {
  categoryId: "",
  budgetLineId: "",
  txnDate: "",
  paymentMethod: "",
  checkNumber: "",
  memo: "",
  bankAccountId: "",
};

function fiscalYearOfIso(iso: string): number | null {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : getFiscalYear(d);
}

export default function CorrectReimbursementDialog({
  transactionId,
  mode,
  open,
  onOpenChange,
  preselectBankAccountId,
  onSaved,
}: CorrectReimbursementDialogProps) {
  const router = useRouter();
  const [state, setState] = useState<CorrectDialogPhase>({ phase: "loading" });
  const [values, setValues] = useState<CorrectFormValues>(EMPTY_VALUES);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [proposal, setProposal] = useState<CorrectProposalState>({ warnings: [], denial: null });
  const [budgetLineCleared, setBudgetLineCleared] = useState(false);
  const baselineRef = useRef<CorrectionPreview | null>(null);

  const url = `/api/admin/ledger/transactions/${transactionId}/correct`;

  // Load the preview whenever the dialog opens (or "Try again" is pressed).
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    setReason("");
    setInlineError(null);
    setBudgetLineCleared(false);
    setProposal({ warnings: [], denial: null });
    baselineRef.current = null;
    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const message = (data as CorrectionErrorBody | null)?.error;
          // A top-level refusal (not correctable, own request, 404) is the
          // server explaining why; a 5xx or unreadable body is worth a retry.
          if (res.status >= 400 && res.status < 500 && message) {
            setState({ phase: "blocked", message });
          } else {
            setState({
              phase: "load_error",
              message: "Something went wrong loading this entry. Please try again.",
            });
          }
          return;
        }
        const preview = data as CorrectionPreview;
        const decision =
          mode === "add_bank_account"
            ? preview.operations.fill_bank_account
            : preview.operations.correct;
        if (!decision.allowed) {
          setState({ phase: "blocked", message: decision.reason });
          return;
        }
        const initial = initialCorrectValues(preview.transaction);
        if (mode === "add_bank_account") {
          initial.bankAccountId = initialFillBankAccountId(preview, preselectBankAccountId);
        }
        baselineRef.current = preview;
        setValues(initial);
        setProposal({ warnings: preview.warnings, denial: null });
        setState({ phase: "form", preview });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({
          phase: "load_error",
          message: "Something went wrong loading this entry. Please try again.",
        });
      }
    })();
    return () => controller.abort();
  }, [open, url, mode, preselectBankAccountId, loadAttempt]);

  // Ask the server what the proposed date / method would trigger, before Save.
  const formPreview = state.phase === "form" ? state.preview : null;
  useEffect(() => {
    if (mode !== "correct" || !formPreview) return;
    const baseline = baselineRef.current;
    if (!baseline) return;
    const query = proposalQuery(storedValuesOf(formPreview.transaction), values);
    if (!query) {
      setProposal({ warnings: baseline.warnings, denial: null });
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${url}${query}`, { signal: controller.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok) return; // The POST is the authority; never block on a preview failure.
        const next = data as CorrectionPreview;
        const op = next.operations.correct;
        setProposal({
          warnings: next.warnings,
          denial: op.allowed ? null : { code: op.code, reason: op.reason },
        });
      } catch {
        // Aborted or offline: keep the last evaluation.
      }
    })();
    return () => controller.abort();
  }, [mode, formPreview, url, values.txnDate, values.paymentMethod]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleOpenChange(next: boolean) {
    const close = resolveCorrectClose({ nextOpen: next, phase: state.phase, submitting });
    if (!close.proceed) return;
    if (close.refresh) router.refresh();
    onOpenChange(next);
  }

  function handleValueChange(patch: Partial<CorrectFormValues>) {
    if (state.phase !== "form") return;
    const result = applyValuePatch(
      values,
      patch,
      state.preview.options.budgetLines,
      fiscalYearOfIso,
    );
    setValues(result.values);
    if (result.budgetLineCleared) setBudgetLineCleared(true);
    else if ("budgetLineId" in patch) setBudgetLineCleared(false);
    setInlineError(null);
  }

  async function handleSubmit() {
    if (state.phase !== "form") return;
    const preview = state.preview;
    setSubmitting(true);
    setInlineError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildCorrectBody({
            mode,
            stored: storedValuesOf(preview.transaction),
            values,
            reason,
            expectedUpdatedAt: preview.transaction.updatedAt,
          }),
        ),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const result = data as CorrectResponse;
        toast.success(correctSuccessMessage(result));
        setState({ phase: "success", result });
        onSaved?.();
        return;
      }
      const action = correctFailureAction(res.status, data as Partial<CorrectionErrorBody> | null);
      if (action.mode === "inline") {
        setInlineError(action.message);
      } else {
        toast.error(action.message);
        if (action.mode === "close_and_refresh") {
          router.refresh();
          onOpenChange(false);
        }
      }
    } catch {
      toast.error(CORRECTION_FAILED_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  const copy = CORRECT_MODE_COPY[mode];
  return (
    <LedgerDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title={copy.title}
      description={copy.description}
    >
      <CorrectDialogBody
        state={state}
        mode={mode}
        values={values}
        reason={reason}
        submitting={submitting}
        inlineError={inlineError}
        proposal={proposal}
        budgetLineCleared={budgetLineCleared}
        onValueChange={handleValueChange}
        onReasonChange={setReason}
        onSubmit={handleSubmit}
        onCancel={() => handleOpenChange(false)}
        onDone={() => handleOpenChange(false)}
        onRetryLoad={() => setLoadAttempt((n) => n + 1)}
      />
    </LedgerDialogShell>
  );
}
