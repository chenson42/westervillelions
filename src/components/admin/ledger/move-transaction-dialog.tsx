"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import LedgerDialogShell from "./ledger-dialog-shell";
import CorrectionReasonField from "./correction-reason-field";
import MoveImpactCard from "./move-impact-card";
import MoveCrossEntityPanel from "./move-cross-entity-panel";
import MoveUnlockChecklist from "./move-unlock-checklist";
import {
  buildMoveBody,
  formatMoneyCents,
  initialBankAccountId,
  isMoveSubmittable,
  moveConfirmLabel,
  moveFailureAction,
  noDestinationHeading,
  resolveMoveClose,
  sweepDeepLink,
} from "./correction-dialog-logic";
import {
  MOVE_FAILED_MESSAGE,
  type CorrectionErrorBody,
  type MovePreview,
  type MoveResponse,
} from "@/lib/ledger-correction";

export type MoveDialogPhase =
  | { phase: "loading" }
  | { phase: "load_error"; message: string }
  | { phase: "blocked"; message: string }
  | { phase: "form"; preview: MovePreview }
  | {
      phase: "success";
      result: MoveResponse;
      /** Display name of the destination entity, for a cross-entity move. */
      destEntityName?: string | null;
    };

type Destination = MovePreview["destinations"][number];

const primaryButton =
  "bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";
const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";
const fieldClass =
  "w-full min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60";

// ---------------------------------------------------------------------------
// Presentational body (state in, events out) so each state is renderable in a
// DOM-less test. Contains no Radix portal.
// ---------------------------------------------------------------------------

export interface MoveDialogBodyProps {
  state: MoveDialogPhase;
  entitySlug: string;
  destFundId: string;
  categoryId: string;
  /** The picked destination bank account ("" when none); cross-entity moves only. */
  bankAccountId: string;
  reason: string;
  submitting: boolean;
  inlineError: string | null;
  onDestChange: (fundId: string) => void;
  onCategoryChange: (categoryId: string) => void;
  onBankAccountChange: (bankAccountId: string) => void;
  /** Re-runs the preview (the checklist's "Check again"). */
  onCheckAgain: () => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
  onRetryLoad: () => void;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="text-gray-500 sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="text-gray-900 break-words">{value}</dd>
    </div>
  );
}

export function MoveDialogBody(props: MoveDialogBodyProps) {
  const { state } = props;

  if (state.phase === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-3 animate-pulse">
        <span className="sr-only">Loading move details</span>
        <div className="h-4 w-2/3 rounded bg-gray-200" />
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
          <p className="font-semibold text-gray-700">Couldn&rsquo;t load the move details</p>
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
          <p className="font-semibold">This entry can&rsquo;t be moved</p>
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
    const { result } = state;
    const where =
      result.crossEntity && state.destEntityName
        ? `${result.fundName} (${state.destEntityName})`
        : result.fundName;
    return (
      <div>
        <div role="status" className="rounded-2xl bg-green-50 p-4 text-green-900">
          <p className="font-semibold">Moved to {where}.</p>
          <p className="mt-1 text-sm">
            Category: {result.categoryName ?? "No category"}. The change is logged with your reason
            on the Compliance page.
          </p>
          {result.acknowledgment === "kept" && (
            <p className="mt-1 text-sm">
              The receipt letter stays attached to the gift and still names the Foundation.
            </p>
          )}
          {result.acknowledgment === "removed" && (
            <p className="mt-1 text-sm">The unsent receipt record was removed.</p>
          )}
        </div>
        {result.sweepSuggested && (
          <p className="mt-3 text-sm text-gray-600">
            Moving did not sweep anything. Once the money has actually been moved, record the sweep
            to the Foundation; you will enter the board-minute reference yourself.
          </p>
        )}
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={props.onDone} className={secondaryButton}>
            Done
          </button>
          {result.sweepSuggested && (
            <Link
              href={sweepDeepLink({
                fundSlug: result.fundSlug,
                // The DESTINATION entity's slug (X7), not the register's.
                entitySlug: result.entitySlug,
                transactionId: result.id,
              })}
              className={primaryButton}
            >
              Record sweep now
            </Link>
          )}
        </div>
      </div>
    );
  }

  // phase === "form"
  const { preview } = state;
  const tx = preview.transaction;
  const allowed = preview.destinations.filter((d) => d.allowed);
  const denied = preview.destinations.filter((d) => !d.allowed);
  const unlockDenied = denied.filter((d) => d.denial?.unlock);
  const plainDenied = denied.filter((d) => !d.denial?.unlock);
  const dest: Destination | undefined = allowed.find((d) => d.fundId === props.destFundId);
  const crossEntity = dest?.crossEntity === true;
  const submittable = isMoveSubmittable({
    destFundId: props.destFundId,
    reason: props.reason,
    crossEntity,
    destBankAccountId: props.bankAccountId,
  });
  const destWarnings = dest?.warnings ?? [];
  const ratchet = destWarnings.filter((w) => w.code === "ratchet");
  // The unsent-receipt sentence is shown as the panel's receipt line, not twice.
  const otherWarnings = destWarnings.filter(
    (w) => w.code !== "ratchet" && !(crossEntity && w.code === "unsent_receipt_removed"),
  );
  const agedNote = crossEntity && destWarnings.some((w) => w.code === "aged_public_fund");
  // Group the select by entity as soon as a destination is on the other entity.
  const grouped = allowed.some((d) => d.crossEntity);
  const entityGroups = grouped
    ? allowed.reduce<Array<{ entityId: string; name: string; items: Destination[] }>>((acc, d) => {
        const g = acc.find((x) => x.entityId === d.entity.id);
        if (g) g.items.push(d);
        else acc.push({ entityId: d.entity.id, name: d.entity.name, items: [d] });
        return acc;
      }, [])
    : [];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (submittable && !props.submitting) props.onConfirm();
      }}
      className="space-y-4"
    >
      <dl className="rounded-2xl bg-gray-50 p-3 space-y-1.5 text-sm">
        <SummaryRow label="Date" value={tx.txnDate} />
        <SummaryRow label="From" value={tx.party ?? "(no party)"} />
        <SummaryRow
          label="Amount"
          value={`${tx.flow === "income" ? "+" : "-"}${formatMoneyCents(tx.amountCents)}`}
        />
        <SummaryRow label="Entity" value={tx.entity.name} />
        <SummaryRow label="Current fund" value={tx.fundName} />
        <SummaryRow label="Bank account" value={tx.bankAccountName ?? "None"} />
        <SummaryRow label="Category" value={tx.categoryName ?? "No category"} />
      </dl>

      {allowed.length === 0 ? (
        <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600" role="alert">
          <p className="font-semibold text-gray-700">{noDestinationHeading(preview.destinations)}</p>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="move-dest" className="block text-sm font-medium text-gray-700 mb-1">
              Move to
            </label>
            <select
              id="move-dest"
              value={props.destFundId}
              onChange={(e) => props.onDestChange(e.target.value)}
              disabled={props.submitting}
              className={fieldClass}
            >
              {grouped
                ? entityGroups.map((g) => (
                    <optgroup key={g.entityId} label={g.name}>
                      {g.items.map((d) => (
                        <option key={d.fundId} value={d.fundId}>
                          {d.name}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : allowed.map((d) => (
                    <option key={d.fundId} value={d.fundId}>
                      {d.name}
                    </option>
                  ))}
            </select>
          </div>

          <div>
            <label htmlFor="move-category" className="block text-sm font-medium text-gray-700 mb-1">
              Category in {dest ? (crossEntity ? `${dest.name} (${dest.entity.name})` : dest.name) : "the new fund"}
            </label>
            <select
              id="move-category"
              value={props.categoryId}
              onChange={(e) => props.onCategoryChange(e.target.value)}
              disabled={props.submitting}
              className={fieldClass}
            >
              <option value="">No category</option>
              {(dest?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {crossEntity
                ? `Categories come from the ${dest?.entity.name}\u2019s books, so the old one cannot carry over.`
                : `The old category belongs to ${tx.fundName}, so a new one is needed here.`}
            </p>
          </div>
        </>
      )}

      {unlockDenied.map((d) => (
        <MoveUnlockChecklist
          key={d.fundId}
          destination={d}
          sourceEntityName={tx.entity.name}
          callerCanManage={preview.callerCanManage}
          onCheckAgain={props.onCheckAgain}
        />
      ))}

      {plainDenied.length > 0 && (
        <ul className="space-y-1 text-xs text-gray-500">
          {plainDenied.map((d) => (
            <li key={d.fundId}>
              <span className="font-medium">
                {d.crossEntity ? `${d.name} (${d.entity.name})` : d.name}:
              </span>{" "}
              {d.denial?.reason ?? "Not available."}
            </li>
          ))}
        </ul>
      )}

      {dest?.impact && dest.impact.crossEntity === false && (
        <section aria-labelledby="move-impact-heading">
          <h3 id="move-impact-heading" className="text-sm font-semibold text-gray-900 mb-2">
            What will change
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoveImpactCard
              heading="Leaves"
              name={dest.impact.sourceFund.name}
              beforeCents={dest.impact.sourceFund.beforeCents}
              afterCents={dest.impact.sourceFund.afterCents}
              caption="all-time balance"
            />
            <MoveImpactCard
              heading="Arrives"
              name={dest.impact.destFund.name}
              beforeCents={dest.impact.destFund.beforeCents}
              afterCents={dest.impact.destFund.afterCents}
              caption="all-time balance"
            />
          </div>
          <p className="mt-2 text-sm text-gray-700">
            {dest.impact.bankAccount.name ?? "Bank account"} balance:{" "}
            <span className="font-semibold">unchanged</span>
          </p>
        </section>
      )}

      {dest && dest.impact && dest.impact.crossEntity && (
        <>
          <section aria-labelledby="move-impact-heading">
            <h3 id="move-impact-heading" className="text-sm font-semibold text-gray-900 mb-2">
              What will change
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoveImpactCard
                heading={`Leaves ${tx.entity.name}`}
                name={dest.impact.sourceFund.name}
                beforeCents={dest.impact.sourceFund.beforeCents}
                afterCents={dest.impact.sourceFund.afterCents}
                caption="all-time balance"
              />
              <MoveImpactCard
                heading={`Arrives in ${dest.entity.name}`}
                name={dest.impact.destFund.name}
                beforeCents={dest.impact.destFund.beforeCents}
                afterCents={dest.impact.destFund.afterCents}
                caption="all-time balance"
              />
            </div>
          </section>
          <MoveCrossEntityPanel
            destination={dest}
            transaction={tx}
            bankAccountId={props.bankAccountId}
            disabled={props.submitting}
            onBankAccountChange={props.onBankAccountChange}
          />
        </>
      )}

      {ratchet.map((w) => (
        <div
          key={w.code}
          role="note"
          className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800"
        >
          <p className="font-semibold">Read before moving</p>
          <p className="mt-1">{w.message}</p>
        </div>
      ))}
      {otherWarnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
          {otherWarnings.map((w) => (
            <li key={w.code}>{w.message}</li>
          ))}
        </ul>
      )}
      {agedNote && (
        <p className="text-sm text-gray-600">
          The moved entry keeps its original date, so it arrives already past the holding period.
          That is expected: the money has been in the club&rsquo;s hands that long, and recording the
          sweep clears the warning.
        </p>
      )}

      {allowed.length > 0 && (
        <CorrectionReasonField
          id="move-reason"
          value={props.reason}
          onChange={props.onReasonChange}
          min={preview.reasonLimits.min}
          max={preview.reasonLimits.max}
          disabled={props.submitting}
          helpText={
            crossEntity
              ? "For example: the gift was deposited to the Club's account, so it was booked to the Foundation by mistake."
              : "For example: the fall drive gift was booked to the Administrative Fund by mistake."
          }
        />
      )}

      {props.inlineError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {props.inlineError}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={props.onCancel}
          disabled={props.submitting}
          className={secondaryButton}
        >
          {allowed.length === 0 ? "Close" : "Cancel"}
        </button>
        {allowed.length > 0 && (
          <button
            type="submit"
            disabled={!submittable || props.submitting}
            className={primaryButton}
          >
            {props.submitting ? "Moving\u2026" : moveConfirmLabel(dest)}
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Stateful dialog
// ---------------------------------------------------------------------------

interface MoveTransactionDialogProps {
  transactionId: string;
  entitySlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MoveTransactionDialog({
  transactionId,
  entitySlug,
  open,
  onOpenChange,
}: MoveTransactionDialogProps) {
  const router = useRouter();
  const [state, setState] = useState<MoveDialogPhase>({ phase: "loading" });
  const [destFundId, setDestFundId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ phase: "loading" });
    setReason("");
    setInlineError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/move`, {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const message = (data as CorrectionErrorBody | null)?.error;
          // A state refusal (403/404/409) is the server explaining why; a
          // 5xx or unreadable response is a load failure worth retrying.
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
        const preview = data as MovePreview;
        const first = preview.destinations.find((d) => d.allowed);
        setDestFundId(first?.fundId ?? "");
        setCategoryId(first?.defaultCategoryId ?? "");
        setBankAccountId(initialBankAccountId(first));
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
  }, [open, transactionId, loadAttempt]);

  function handleOpenChange(next: boolean) {
    const close = resolveMoveClose({ nextOpen: next, phase: state.phase, submitting });
    if (!close.proceed) return;
    if (close.refresh) router.refresh();
    onOpenChange(next);
  }

  function handleDestChange(fundId: string) {
    setDestFundId(fundId);
    if (state.phase === "form") {
      const d = state.preview.destinations.find((x) => x.fundId === fundId);
      setCategoryId(d?.defaultCategoryId ?? "");
      // Never carry a pick from one destination's accounts to another's.
      setBankAccountId(initialBankAccountId(d));
    }
  }

  async function handleConfirm() {
    if (state.phase !== "form") return;
    const selected = state.preview.destinations.find((d) => d.allowed && d.fundId === destFundId);
    const crossEntity = selected?.crossEntity === true;
    setSubmitting(true);
    setInlineError(null);
    try {
      const res = await fetch(`/api/admin/ledger/transactions/${transactionId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildMoveBody({
            destFundId,
            categoryId,
            reason,
            expectedFundId: state.preview.transaction.fundId,
            destBankAccountId: crossEntity ? bankAccountId : undefined,
          }),
        ),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setState({
          phase: "success",
          result: data as MoveResponse,
          destEntityName: crossEntity ? selected?.entity.name : null,
        });
        return;
      }
      const action = moveFailureAction(res.status, data as Partial<CorrectionErrorBody> | null);
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
      toast.error(MOVE_FAILED_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LedgerDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Move to another fund"
      description="Move this ledger entry to another fund, with a reason that is logged."
    >
      <MoveDialogBody
        state={state}
        entitySlug={entitySlug}
        destFundId={destFundId}
        categoryId={categoryId}
        bankAccountId={bankAccountId}
        reason={reason}
        submitting={submitting}
        inlineError={inlineError}
        onDestChange={handleDestChange}
        onCategoryChange={setCategoryId}
        onBankAccountChange={setBankAccountId}
        onCheckAgain={() => setLoadAttempt((n) => n + 1)}
        onReasonChange={setReason}
        onConfirm={handleConfirm}
        onCancel={() => handleOpenChange(false)}
        onDone={() => handleOpenChange(false)}
        onRetryLoad={() => setLoadAttempt((n) => n + 1)}
      />
    </LedgerDialogShell>
  );
}
