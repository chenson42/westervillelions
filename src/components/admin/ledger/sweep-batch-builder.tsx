"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import SweepGiftList from "./sweep-gift-list";
import SweepReviewPanel, { type SweepAccountOption } from "./sweep-review-panel";
import SweepCloseoutDialog from "./sweep-closeout-dialog";
import SweepUnmarkConfirm from "./sweep-unmark-confirm";
import {
  DRIFT_MESSAGE,
  PREVIEW_URL,
  SWEEP_FIFO_LINE,
  canSubmitSweep,
  createSweepPostController,
  formatSweepDate,
  formatSweepMoney,
  isFutureSweepDate,
  selectAllIds,
  type PostResult,
} from "./sweep-builder-logic";
import { parseDollarsToCents } from "@/lib/ledger";
import type { FundLabels } from "@/lib/ledger-fund-labels";
import {
  SWEEP_BATCH_MAX,
  SWEEP_ERROR_COPY,
  SWEEP_ROW_REFUSAL_COPY,
  type SweepBatchCreatedResponse,
  type SweepCandidates,
  type SweepCloseoutRow,
  type SweepErrorBody,
  type SweepPreviewResponse,
  type SweepRowRefusal,
} from "@/lib/ledger-sweep";

export interface SweepBatchBuilderProps {
  labels: FundLabels;
  candidates: SweepCandidates;
  /** Ids from `?sweep=`, already UUID-filtered by the page. */
  preselect: string[];
  sourceAccounts: SweepAccountOption[];
  destAccounts: SweepAccountOption[];
  defaultSourceAccountId: string;
  defaultDestAccountId: string;
  /** Eastern today, YYYY-MM-DD. */
  today: string;
  canManage: boolean;
  /** Only passed for `ledger.manage` holders. */
  closeouts: SweepCloseoutRow[];
  links: { sourceRegister: string; destRegister: string; approvals: string };
}

type Step = "select" | "review" | "done";

type DoneState =
  | { kind: "created"; created: SweepBatchCreatedResponse }
  | { kind: "neutral"; message: string };

const primaryButton =
  "bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center";
const secondaryButton =
  "border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center";
const linkClass =
  "text-sm font-semibold text-lions-blue hover:text-lions-blue-dark underline-offset-2 hover:underline min-h-[44px] inline-flex items-center rounded focus:outline-none focus:ring-2 focus:ring-lions-blue";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export default function SweepBatchBuilder(props: SweepBatchBuilderProps) {
  const {
    labels,
    candidates,
    today,
    canManage,
    sourceAccounts,
    destAccounts,
    links,
  } = props;
  const router = useRouter();

  const eligibleIds = useMemo(() => candidates.eligible.map((r) => r.sourceId), [candidates.eligible]);
  const eligibleById = useMemo(
    () => new Map(candidates.eligible.map((r) => [r.sourceId, r])),
    [candidates.eligible],
  );

  const [step, setStep] = useState<Step>("select");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(props.preselect.filter((id) => eligibleById.has(id)).slice(0, SWEEP_BATCH_MAX)),
  );
  const [markSelected, setMarkSelected] = useState<Set<string>>(new Set());
  const [closeoutIds, setCloseoutIds] = useState<string[] | null>(null);
  const [capNotice, setCapNotice] = useState(false);

  const [sweepDate, setSweepDate] = useState(today);
  const [sourceAccountId, setSourceAccountId] = useState(props.defaultSourceAccountId);
  const [destAccountId, setDestAccountId] = useState(props.defaultDestAccountId);
  const [bankAmountText, setBankAmountText] = useState("");
  const [boardMinute, setBoardMinute] = useState("");
  const [priorYearReason, setPriorYearReason] = useState("");

  const [preview, setPreview] = useState<SweepPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshRows, setRefreshRows] = useState<{ sourceId: string; code: SweepRowRefusal }[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);

  const previewSeq = useRef(0);
  const controllerRef = useRef<ReturnType<typeof createSweepPostController> | null>(null);

  const typedCents = parseDollarsToCents(bankAmountText);

  const selectedItems = candidates.eligible.filter((r) => selected.has(r.sourceId));
  const selectedTotal = selectedItems.reduce((sum, r) => sum + r.amountCents, 0);
  const noDonorCount = candidates.eligible.filter((r) => !r.hasDonor).length;

  const preselectMissing = props.preselect.filter((id) => !eligibleById.has(id)).length;

  // ---------------------------------------------------------------- selection
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < SWEEP_BATCH_MAX) next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === eligibleIds.length) {
      setSelected(new Set());
      setCapNotice(false);
      return;
    }
    const all = selectAllIds(eligibleIds);
    setSelected(new Set(all.ids));
    setCapNotice(all.capped);
  }
  function toggleMark(id: string) {
    setMarkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ------------------------------------------------------------------ preview
  async function loadPreview(next: {
    ids: string[];
    date: string;
    source: string;
    dest: string;
  }): Promise<void> {
    const seq = ++previewSeq.current;
    setPreviewError(null);
    if (!next.date) {
      setPreview(null);
      setPreviewError(SWEEP_ERROR_COPY.invalid_date(labels));
      return;
    }
    if (isFutureSweepDate(next.date, today)) {
      setPreview(null);
      setPreviewError(SWEEP_ERROR_COPY.future_date(labels));
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(PREVIEW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: next.ids,
          sourceBankAccountId: next.source,
          destBankAccountId: next.dest,
          sweepDate: next.date,
        }),
      });
      const data = (await res.json().catch(() => null)) as (SweepPreviewResponse & Partial<SweepErrorBody>) | null;
      if (seq !== previewSeq.current) return;
      if (!res.ok || !data || !Array.isArray(data.rows)) {
        setPreview(null);
        setPreviewError(
          (typeof data?.error === "string" && data.error) ||
            "We could not check the gifts just now. Nothing was recorded; try again.",
        );
        return;
      }
      setPreview(data);
    } catch {
      if (seq !== previewSeq.current) return;
      setPreview(null);
      setPreviewError("We could not check the gifts just now. Nothing was recorded; try again.");
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  }

  const selectedIds = [...selected];
  function startReview() {
    if (selectedIds.length === 0) return;
    setNotice(null);
    setRefreshRows(null);
    setPreview(null);
    setStep("review");
    void loadPreview({ ids: selectedIds, date: sweepDate, source: sourceAccountId, dest: destAccountId });
  }
  function onDateChange(value: string) {
    setSweepDate(value);
    setNotice(null);
    void loadPreview({ ids: selectedIds, date: value, source: sourceAccountId, dest: destAccountId });
  }
  function onSourceChange(value: string) {
    setSourceAccountId(value);
    void loadPreview({ ids: selectedIds, date: sweepDate, source: value, dest: destAccountId });
  }
  function onDestChange(value: string) {
    setDestAccountId(value);
    void loadPreview({ ids: selectedIds, date: sweepDate, source: sourceAccountId, dest: value });
  }
  function leaveOutRefused() {
    if (!preview) return;
    const refused = new Set(preview.rows.filter((r) => r.refusal !== null).map((r) => r.sourceId));
    const nextIds = selectedIds.filter((id) => !refused.has(id));
    setSelected(new Set(nextIds));
    if (nextIds.length === 0) {
      setStep("select");
      return;
    }
    void loadPreview({ ids: nextIds, date: sweepDate, source: sourceAccountId, dest: destAccountId });
  }

  // --------------------------------------------------------------------- post
  const canPostNow = canSubmitSweep({
    preview,
    typedCents,
    boardMinute,
    priorYearReason,
    sweepDate,
    today,
    submitting,
    previewLoading,
  });

  async function post() {
    if (!preview || typedCents === null) return;
    // The controller holds the lock, so even a second click that beats React's
    // re-render sends nothing (B6).
    controllerRef.current ??= createSweepPostController({
      fetch: (input, init) => fetch(input, init),
      labels,
    });
    setSubmitting(true);
    setNotice(null);
    let result: PostResult;
    try {
      result = await controllerRef.current.post({
        reviewed: preview,
        body: {
          sourceIds: selectedIds,
          sourceBankAccountId: sourceAccountId,
          destBankAccountId: destAccountId,
          sweepDate,
          bankAmountCents: typedCents,
          boardMinute: boardMinute.trim(),
          ...(preview.needsReason ? { priorYearReason: priorYearReason.trim() } : {}),
        },
      });
    } finally {
      setSubmitting(false);
    }
    switch (result.kind) {
      case "ignored":
        return;
      case "drifted":
        setPreview(result.preview);
        setNotice(DRIFT_MESSAGE);
        return;
      case "preview_failed":
      case "fix":
      case "denied":
      case "not_recorded":
        setNotice(result.message);
        return;
      case "refresh":
        setNotice(result.message);
        setRefreshRows(result.rows);
        return;
      case "created":
        toast.success(
          result.created.status === "pending"
            ? "Sent to the board for approval."
            : "Sweep posted to the Foundation.",
        );
        setDone({ kind: "created", created: result.created });
        setStep("done");
        setSelected(new Set());
        router.refresh();
        return;
      case "already_in_batch":
      case "unconfirmed":
        setDone({ kind: "neutral", message: result.message });
        setStep("done");
        setSelected(new Set());
        router.refresh();
        return;
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  function startOver() {
    controllerRef.current = null;
    setDone(null);
    setStep("select");
    setPreview(null);
    setPreviewError(null);
    setNotice(null);
    setRefreshRows(null);
    setBankAmountText("");
    setBoardMinute("");
    setPriorYearReason("");
    setSweepDate(today);
    router.refresh();
  }

  // ------------------------------------------------------------------- render
  if (step === "done" && done) {
    return (
      <div className="rounded-2xl bg-white shadow-sm p-6 space-y-4" role="status">
        {done.kind === "created" ? (
          <>
            <h2 className="text-lg font-semibold text-gray-900">
              {done.created.status === "pending" ? "Sent to the board for approval" : "Sweep posted"}
            </h2>
            <p className="text-sm text-gray-700">
              {done.created.count} {plural(done.created.count, "gift", "gifts")},{" "}
              {formatSweepMoney(done.created.totalCents)}.{" "}
              {done.created.status === "pending"
                ? "The gifts stay where they are until one approver agrees. You can reject the batch from Approvals to free them."
                : "Each gift now has its own entry on the Foundation's books."}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900">Check before trying again</h2>
            <p className="text-sm text-gray-700">{done.message}</p>
          </>
        )}
        <div className="flex flex-wrap gap-x-4">
          <Link
            href={done.kind === "created" && done.created.status === "pending" ? `${links.approvals}?txn=${done.created.legId}` : links.approvals}
            className={linkClass}
          >
            Approvals
          </Link>
          <Link href={links.sourceRegister} className={linkClass}>
            {labels.activity} register
          </Link>
          <Link href={links.destRegister} className={linkClass}>
            Foundation register
          </Link>
        </div>
        {done.kind === "created" && (
          <button type="button" onClick={startOver} className={secondaryButton}>
            Sweep more gifts
          </button>
        )}
      </div>
    );
  }

  if (step === "review") {
    return (
      <>
        <SweepReviewPanel
          labels={labels}
          preview={preview}
          loading={previewLoading}
          loadError={previewError}
          notice={notice}
          sweepDate={sweepDate}
          today={today}
          onSweepDateChange={onDateChange}
          sourceAccounts={sourceAccounts}
          destAccounts={destAccounts}
          sourceAccountId={sourceAccountId}
          destAccountId={destAccountId}
          onSourceAccountChange={onSourceChange}
          onDestAccountChange={onDestChange}
          bankAmountText={bankAmountText}
          typedCents={typedCents}
          onBankAmountChange={setBankAmountText}
          boardMinute={boardMinute}
          onBoardMinuteChange={setBoardMinute}
          priorYearReason={priorYearReason}
          onReasonChange={setPriorYearReason}
          submitting={submitting}
          canPostNow={canPostNow}
          onBack={() => {
            setStep("select");
            setNotice(null);
          }}
          onPost={() => setConfirmOpen(true)}
          onLeaveOutRefused={leaveOutRefused}
        />
        {refreshRows && (
          <div className="mt-4 rounded-2xl bg-white shadow-sm p-4 space-y-3">
            {refreshRows.length > 0 && (
              <ul className="space-y-1 text-sm text-gray-700">
                {refreshRows.map((r) => (
                  <li key={r.sourceId}>{SWEEP_ROW_REFUSAL_COPY[r.code](labels)}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                setRefreshRows(null);
                setNotice(null);
                setStep("select");
                setSelected(new Set());
                router.refresh();
              }}
            >
              Refresh the list
            </button>
          </div>
        )}
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Post this sweep to the Foundation?"
          description={
            preview
              ? `${preview.count} ${plural(preview.count, "gift", "gifts")}, ${formatSweepMoney(preview.totalCents)}. ${
                  preview.status === "pending"
                    ? "It is over the approval threshold, so it goes to the board and posts when one approver agrees."
                    : "It posts right away. A manager can void it until the board approves it or a bank statement clears it."
                }`
              : ""
          }
          confirmLabel="Post sweep"
          onConfirm={() => {
            setConfirmOpen(false);
            void post();
          }}
        />
      </>
    );
  }

  // step === "select"
  const hasEligible = candidates.eligible.length > 0;
  const heldItems = candidates.heldBack.map(({ row, refusal }) => ({
    row,
    note: SWEEP_ROW_REFUSAL_COPY[refusal](labels),
  }));

  return (
    <div className="space-y-6">
      {props.preselect.length > 0 && preselectMissing > 0 && (
        <p role="status" className="rounded-lg border border-lions-gold bg-amber-50 p-3 text-sm text-gray-800">
          {preselectMissing === 1
            ? "One of the gifts you came here with cannot be swept right now. Check the held back list below."
            : `${preselectMissing} of the gifts you came here with cannot be swept right now. Check the held back list below.`}
        </p>
      )}

      {candidates.inPendingBatch.length > 0 && (
        <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          {candidates.inPendingBatch.length} {plural(candidates.inPendingBatch.length, "gift is", "gifts are")} in a
          batch waiting for board approval.{" "}
          <Link href={links.approvals} className="font-semibold text-lions-blue hover:underline">
            Open Approvals
          </Link>
        </p>
      )}

      <section className="rounded-2xl bg-white shadow-sm overflow-hidden" aria-labelledby="sweep-gifts-heading">
        <div className="p-4 sm:p-6 space-y-3">
          <h2 id="sweep-gifts-heading" className="text-lg font-semibold text-gray-900">
            Gifts ready to sweep
          </h2>
          <p className="text-sm text-gray-600">{SWEEP_FIFO_LINE}</p>
          {noDonorCount > 0 && (
            <p className="text-sm text-gray-600">
              {noDonorCount} {plural(noDonorCount, "gift has", "gifts have")} no donor record. They can still be
              swept, but the Foundation&rsquo;s donor history will not show them.
            </p>
          )}
          {hasEligible && (
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer text-sm font-medium text-gray-800">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === eligibleIds.length}
                onChange={toggleAll}
                className="h-5 w-5 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              Select all {eligibleIds.length} {plural(eligibleIds.length, "gift", "gifts")}
            </label>
          )}
          {capNotice && (
            <p role="status" className="text-sm text-gray-700">
              A batch holds at most {SWEEP_BATCH_MAX} gifts, so the first {SWEEP_BATCH_MAX} are selected. Sweep the
              rest in another batch.
            </p>
          )}
        </div>

        {hasEligible ? (
          <div className="px-4 pb-4 sm:px-6">
            <SweepGiftList
              items={candidates.eligible.map((row) => ({ row }))}
              caption="Gifts ready to sweep to the Foundation"
              selection={{ selected, onToggle: toggle, idPrefix: "sweep-gift" }}
            />
          </div>
        ) : (
          <div className="mx-4 mb-4 sm:mx-6 sm:mb-6 bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No gifts are waiting to be swept. When a gift is recorded in {labels.activity}, it appears here.
          </div>
        )}

        <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-gray-200 bg-white/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-sm text-gray-700" aria-live="polite">
            <span className="font-semibold">{selected.size}</span> {plural(selected.size, "gift", "gifts")} selected
            {selected.size > 0 && (
              <>
                , <span className="font-semibold tabular-nums">{formatSweepMoney(selectedTotal)}</span>
              </>
            )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {canManage && (
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setCloseoutIds(selectedIds)}
                className={secondaryButton}
              >
                Mark as already handled
              </button>
            )}
            <button type="button" disabled={selected.size === 0} onClick={startReview} className={primaryButton}>
              Review sweep
            </button>
          </div>
        </div>
      </section>

      {heldItems.length > 0 && (
        <details className="rounded-2xl bg-white shadow-sm p-4 sm:p-6">
          <summary className="cursor-pointer min-h-[44px] flex items-center text-lg font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
            Held back ({heldItems.length})
          </summary>
          <p className="mt-2 mb-3 text-sm text-gray-600">
            These gifts cannot be swept yet. Each one says what to fix.
          </p>
          <SweepGiftList
            items={heldItems}
            caption="Gifts held back from the sweep"
            showDestination={false}
            selection={canManage ? { selected: markSelected, onToggle: toggleMark, idPrefix: "sweep-held" } : undefined}
          />
          {canManage && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={markSelected.size === 0}
                onClick={() => setCloseoutIds([...markSelected])}
                className={secondaryButton}
              >
                Mark selected as already handled
              </button>
            </div>
          )}
        </details>
      )}

      {canManage && props.closeouts.length > 0 && (
        <details className="rounded-2xl bg-white shadow-sm p-4 sm:p-6">
          <summary className="cursor-pointer min-h-[44px] flex items-center text-lg font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
            Marked as already handled ({props.closeouts.length})
          </summary>
          <ul className="mt-3 divide-y divide-gray-100">
            {props.closeouts.map((c) => {
              const summary = `${c.party?.trim() || "No payer recorded"}, ${formatSweepDate(c.giftDate)}, ${formatSweepMoney(c.amountCents)}`;
              return (
                <li key={c.sourceId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium text-gray-900 break-words">{summary}</p>
                    <p className="text-gray-600 break-words">Reason: {c.reason}</p>
                  </div>
                  <SweepUnmarkConfirm sourceId={c.sourceId} summary={summary} labels={labels} />
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {closeoutIds && (
        <SweepCloseoutDialog
          open
          onOpenChange={(next) => {
            if (!next) setCloseoutIds(null);
          }}
          sourceIds={closeoutIds}
          labels={labels}
          onMarked={() => {
            setSelected(new Set());
            setMarkSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
