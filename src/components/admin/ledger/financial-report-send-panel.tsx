"use client";

/**
 * "Send to Board" panel for the Monthly Statement of Financial Condition.
 * Renders on `/admin/ledger/reports` (src/app/(dashboard)/admin/ledger/reports/page.tsx),
 * above the existing per-fund report cards.
 *
 * docs/work-log/2026-09-25-financial-report-auto-send.md, Phase 3 "Component / Page Plan".
 *
 * Data comes from `listReadyToSendReports()` (src/lib/financial-report-send.ts),
 * called server-side by the page — this component never fetches the list
 * itself. It only calls POST /api/admin/ledger/reports/send when a send is
 * confirmed, then asks Next.js to re-run the Server Component's data fetch
 * (`router.refresh()`) so the row moves from actionable to "Sent" without a
 * manual page reload.
 *
 * `canSend` is a SERVER-COMPUTED boolean (hasFeature(session.user.id,
 * FEATURES.LEDGER_REPORT_SEND), evaluated in the page) — not a client-side
 * read of session.user.features. The POST route independently re-checks the
 * same permission; a viewer without it never sees a Send control here, but
 * that's cosmetic only, not the real gate.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ReadyToSendReport } from "@/lib/financial-report-send";

interface FinancialReportSendPanelProps {
  rows: ReadyToSendReport[];
  canSend: boolean;
}

type TreasurerUnresolvedReason = "no_board_group" | "none" | "multiple";

const TREASURER_UNRESOLVED_MESSAGE: Record<TreasurerUnresolvedReason, string> = {
  no_board_group:
    "No \"Board of Directors\" group was found, so there's no one to sign this statement as Treasurer. Set that up before sending.",
  none:
    "Nobody currently holds the Board position of Treasurer, so this statement has no one to sign it. Set the Treasurer position in the Board of Directors group before sending.",
  multiple:
    "More than one member is marked as Treasurer in the Board of Directors group, so this statement can't resolve a single signer. Fix the group position before sending.",
};

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function rowKey(row: ReadyToSendReport): string {
  return `${row.entityId}:${row.month}`;
}

/**
 * Minimal single-flight guard: `acquire()` returns true exactly once and
 * false on any call while already held, until `release()` is called.
 * Exported and framework-free so the double-submit guard's actual semantics
 * are unit-testable without simulating a real double-click through a DOM
 * this project's Vitest config doesn't run (node environment, no
 * jsdom/@testing-library — see member-form.test.ts's docblock).
 */
export function createSingleFlightGuard() {
  let inFlight = false;
  return {
    acquire(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release(): void {
      inFlight = false;
    },
  };
}

/** Maps every typed SendReportResult failure reason to human copy an admin can act on. */
export function errorMessageFor(reason: string, detail: string | undefined): string {
  switch (reason) {
    case "treasurer_unresolved":
      return (
        TREASURER_UNRESOLVED_MESSAGE[detail as TreasurerUnresolvedReason] ??
        "The Treasurer position couldn't be resolved, so this statement has no one to sign it. Fix the Board of Directors group before sending."
      );
    case "not_found":
      return "Couldn't find that entity or fund. Refresh the page and try again.";
    case "invalid_month":
      return "That month wasn't valid. Refresh the page and try again.";
    case "not_ready":
      return "This month is no longer ready to send — its reconciliation status changed. Refresh the page to see current status.";
    case "already_sent":
      return "This exact statement was already sent to the board — nothing changed since then.";
    case "send_failed":
      return detail
        ? `The email could not be sent: ${detail}`
        : "The email could not be sent. Try again, or check the email queue for details.";
    case "blocked_non_production":
      return (
        detail ??
        "Blocked — outbound email is disabled outside production. Nothing was delivered; this is expected in dev/test, not an error. The statement is still marked not sent and can be tried again."
      );
    default:
      return "Something went wrong sending this statement. Try again.";
  }
}

function StateBadge({ state }: { state: ReadyToSendReport["state"] }) {
  if (state === "sent") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        Sent
      </span>
    );
  }
  if (state === "corrected") {
    return (
      <span className="inline-flex items-center rounded-full bg-lions-gold/20 px-2.5 py-0.5 text-xs font-medium text-lions-gold-dark">
        Corrected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
      Not yet sent
    </span>
  );
}

function ReportRow({
  row,
  canSend,
  sendingKey,
  onRequestSend,
}: {
  row: ReadyToSendReport;
  canSend: boolean;
  sendingKey: string | null;
  onRequestSend: (row: ReadyToSendReport) => void;
}) {
  const key = rowKey(row);
  const isSent = row.state === "sent";
  const isSending = sendingKey === key;

  return (
    <div
      className={`rounded-2xl overflow-hidden ${
        isSent ? "bg-gray-50 shadow-none" : "bg-white shadow-sm"
      }`}
    >
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {row.entityName} &bull; {row.fundName}
            </p>
            <h3 className={`text-base font-semibold ${isSent ? "text-gray-600" : "text-gray-900"}`}>
              {row.monthEndLabel}
            </h3>
          </div>
          <StateBadge state={row.state} />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <span className="text-gray-500">Ending Balance: </span>
            <span className="font-medium text-gray-800 tabular-nums">
              {formatDollars(row.summary.endingBookBalanceCents)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">This Month&apos;s Net: </span>
            <span className="font-medium text-gray-800 tabular-nums">
              {formatDollars(row.summary.netOneMonthCents)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">FYTD Net: </span>
            <span className="font-medium text-gray-800 tabular-nums">
              {formatDollars(row.summary.netTwelveMonthCents)}
            </span>
          </div>
        </div>

        {row.state === "corrected" && row.lastSuccessfulSend && (
          <p className="text-sm text-lions-gold-dark bg-lions-gold/10 rounded-lg px-3 py-2">
            The figures changed since the statement sent on{" "}
            {formatDate(row.lastSuccessfulSend.sentAt)}. The board is holding stale numbers until
            a corrected statement goes out.
          </p>
        )}

        {row.state === "sent" && row.lastSuccessfulSend && (
          <p className="text-sm text-gray-500">
            Sent {formatDate(row.lastSuccessfulSend.sentAt)}
            {row.lastSuccessfulSend.signedAsName ? ` by ${row.lastSuccessfulSend.signedAsName}` : ""}.
          </p>
        )}

        {row.lastAttemptFailed && (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            Last attempt failed on {formatDate(row.lastAttemptFailed.sentAt)}
            {row.lastAttemptFailed.error ? `: ${row.lastAttemptFailed.error}` : "."}
          </p>
        )}

        {!isSent && canSend && (
          <button
            type="button"
            onClick={() => onRequestSend(row)}
            disabled={isSending}
            className="w-full sm:w-auto min-h-[44px] bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            {isSending
              ? "Sending…"
              : row.state === "corrected"
                ? "Resend Corrected Statement"
                : "Send to Board"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function FinancialReportSendPanel({ rows, canSend }: FinancialReportSendPanelProps) {
  const router = useRouter();
  const [confirmRow, setConfirmRow] = useState<ReadyToSendReport | null>(null);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  // Held across renders in a ref: state drives the disabled/label UI, but a
  // genuine double-click can fire two onConfirm calls before a React state
  // update commits and re-renders the disabled button. acquire() is checked
  // synchronously so the second call bails out regardless of render timing
  // — the actual "at most one request" guard (see createSingleFlightGuard's
  // own doc comment for why this is a plain exported function, not inline).
  const guardRef = useRef(createSingleFlightGuard());

  if (rows.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        No statements ready to send yet.
      </div>
    );
  }

  async function handleConfirm() {
    if (!confirmRow) return;
    if (!guardRef.current.acquire()) return; // double-submit guard — a request is already in flight
    const row = confirmRow;
    const key = rowKey(row);
    setSendingKey(key);
    try {
      const res = await fetch("/api/admin/ledger/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: row.entityId, month: row.month }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(errorMessageFor(data?.error, data?.detail));
        return;
      }
      toast.success(
        data.corrected
          ? `Corrected ${row.fundName} statement for ${row.monthEndLabel} sent to the board.`
          : `${row.fundName} statement for ${row.monthEndLabel} sent to the board.`,
      );
      router.refresh();
    } catch {
      toast.error("Could not reach the server. Try again.");
    } finally {
      guardRef.current.release();
      setSendingKey(null);
      setConfirmRow(null);
    }
  }

  return (
    <>
      <div className="space-y-4">
        {rows.map((row) => (
          <ReportRow
            key={rowKey(row)}
            row={row}
            canSend={canSend}
            sendingKey={sendingKey}
            onRequestSend={setConfirmRow}
          />
        ))}
      </div>

      <ConfirmDialog
        open={confirmRow !== null}
        onOpenChange={(open) => {
          if (!open && !sendingKey) setConfirmRow(null);
        }}
        title={
          confirmRow
            ? confirmRow.state === "corrected"
              ? `Resend the corrected ${confirmRow.fundName} statement for ${confirmRow.monthEndLabel}?`
              : `Send the ${confirmRow.fundName} statement for ${confirmRow.monthEndLabel} to the board?`
            : ""
        }
        description={
          confirmRow
            ? confirmRow.state === "corrected" && confirmRow.lastSuccessfulSend
              ? `This replaces the version sent on ${formatDate(
                  confirmRow.lastSuccessfulSend.sentAt,
                )} — the totals changed since then. It goes to board@westervillelions.org labeled "Corrected" and cannot be undone.`
              : `This emails a summary to board@westervillelions.org with a link to the full statement in the member portal. This cannot be undone.`
            : ""
        }
        confirmLabel={
          sendingKey
            ? "Sending…"
            : confirmRow?.state === "corrected"
              ? "Resend Corrected Statement"
              : "Send to Board"
        }
        onConfirm={() => void handleConfirm()}
      />
    </>
  );
}
