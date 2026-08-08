"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatBudgetReferenceCents } from "@/lib/ledger";
import type { GeneratableAcknowledgmentRow } from "@/lib/ledger-acknowledgment-letter-queries";
import AcknowledgmentLettersPrint, {
  type PrintableAcknowledgmentLetter,
} from "./acknowledgment-letters-print";

interface Props {
  initialRows: GeneratableAcknowledgmentRow[];
  /** Deep-linked from AckQueue / donor-detail-client (?ackId=<id>) — pre-checks that one row. */
  preselectedAckId?: string;
  canRecord: boolean;
}

type GenerateResult = {
  ackId: string;
  status: "generated" | "skipped";
  reason?: string;
  letterText?: string;
};

/** Batches above this size get a <ConfirmDialog> before writing (DECISION-072 §7 suggestion,
 *  Phase 3 Edge Cases — small batches, the common case, shouldn't need a confirm). */
const LARGE_BATCH_THRESHOLD = 10;

/**
 * Formats an ISO 'YYYY-MM-DD' string as "Aug 8, 2026" via an explicit local
 * Date construction — NOT `new Date(isoString)`, which parses as UTC
 * midnight and can display a day off in a US timezone (the same
 * naive-timestamp-as-UTC class of bug this codebase has hit before; mirrors
 * composeAcknowledgmentLetter()'s own formatGiftDate()).
 */
function formatYMD(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ackTypeLabel(type: string): string {
  if (type === "written_ack_250") return "Written ($250+)";
  if (type === "quid_pro_quo_75") return "Quid pro quo ($75+)";
  return type;
}

/**
 * Batch/single acknowledgment-letter selector — the checkbox list, "Generate
 * Letters" trigger, per-row result feedback, and the "Print / Save as PDF"
 * trigger (Acknowledgment Letter Generation, DECISION-072/073, 2026-08-08).
 *
 * Renders its own `print:hidden` interactive region AND the always-mounted
 * `AcknowledgmentLettersPrint` as SIBLINGS (not nested) — nesting the print
 * component inside a `print:hidden` ancestor would hide it from print too,
 * since `display:none` on an ancestor removes descendants from the print
 * render tree regardless of their own `print:block`. Both live here (rather
 * than split across this component and its parent page) because the
 * generated-letters state only exists client-side, after a POST — a Server
 * Component page can't hold it.
 *
 * Batch of one IS a single generation (DECISION-072 §4) — there is no
 * separate "generate one" code path; selecting exactly one row and clicking
 * "Generate Letters" calls the identical endpoint.
 */
export default function AcknowledgmentLetterSelector({
  initialRows,
  preselectedAckId,
  canRecord,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        preselectedAckId && initialRows.some((r) => r.ackId === preselectedAckId)
          ? [preselectedAckId]
          : [],
      ),
  );
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<GenerateResult[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Accumulates every letter GENERATED this session (across possibly
  // multiple batches) — the print set is everything ready to print, not just
  // the most recent click's results. Regenerating a row updates it in place.
  const [generatedByAckId, setGeneratedByAckId] = useState<
    Map<string, PrintableAcknowledgmentLetter>
  >(new Map());

  const rowsById = useMemo(() => new Map(rows.map((r) => [r.ackId, r])), [rows]);
  const printableLetters = useMemo(() => Array.from(generatedByAckId.values()), [generatedByAckId]);

  function toggle(ackId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ackId)) next.delete(ackId);
      else next.add(ackId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.ackId))));
  }

  async function runGenerate() {
    if (selected.size === 0) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/ledger/acknowledgments/letters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ackIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate letters.");
      }
      const data: { results: GenerateResult[] } = await res.json();
      setResults(data.results);

      setGeneratedByAckId((prev) => {
        const next = new Map(prev);
        for (const r of data.results) {
          if (r.status === "generated" && r.letterText) {
            const row = rowsById.get(r.ackId);
            next.set(r.ackId, {
              ackId: r.ackId,
              donorName: row?.donor?.name ?? "",
              donorAddress: row?.donor?.address ?? "",
              letterText: r.letterText,
            });
          }
        }
        return next;
      });

      const generatedCount = data.results.filter((r) => r.status === "generated").length;
      const skippedCount = data.results.length - generatedCount;
      if (skippedCount === 0) {
        toast.success(`${generatedCount} letter${generatedCount !== 1 ? "s" : ""} generated.`);
      } else if (generatedCount === 0) {
        toast.error(`All ${skippedCount} selected gift${skippedCount !== 1 ? "s" : ""} were skipped — see details below.`);
      } else {
        toast.warning(`${generatedCount} generated, ${skippedCount} skipped — see details below.`);
      }

      // Refresh the candidate list — per the GET .../generatable route's own
      // doc comment, this is exactly the "select all -> generate" client
      // refresh it exists for. Generation doesn't remove rows (still unsent,
      // freely regeneratable), but keeps donor/entity data current for a
      // follow-up batch in the same session.
      const refreshed = await fetch("/api/admin/ledger/acknowledgments/letters/generatable")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (refreshed?.rows) setRows(refreshed.rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate letters. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleGenerateClick() {
    if (selected.size > LARGE_BATCH_THRESHOLD) {
      setConfirmOpen(true);
    } else {
      runGenerate();
    }
  }

  return (
    <>
      <div className="print:hidden space-y-4">
        {rows.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium text-green-700">Nothing to generate.</p>
            <p className="mt-1 text-sm">
              Every recorded, un-sent acknowledgment already has a letter, or there are no
              acknowledgments pending. Record one from the{" "}
              <Link
                href="/admin/ledger/donors?tab=acknowledgments"
                className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                Pending Acknowledgments
              </Link>{" "}
              tab first.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                {selected.size} of {rows.length} selected
              </p>
              {canRecord && (
                <button
                  type="button"
                  onClick={handleGenerateClick}
                  disabled={selected.size === 0 || generating}
                  className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  {generating
                    ? "Generating…"
                    : `Generate ${selected.size > 0 ? selected.size : ""} Letter${selected.size === 1 ? "" : "s"}`}
                </button>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={rows.length > 0 && selected.size === rows.length}
                          onChange={toggleAll}
                          aria-label="Select all"
                          className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Donor
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {rows.map((row) => {
                      const blocked = !row.donor
                        ? "No donor linked"
                        : !row.donor.address || row.donor.address.trim() === ""
                          ? "Missing address"
                          : null;
                      // Not a blocker — generation still succeeds — but the letter will read
                      // generic "goods or services" wording instead of naming what the donor
                      // actually received. Surfaced here (not just in AcknowledgeDialog) because
                      // this is the treasurer's last look before printing.
                      const missingQpqDescription =
                        row.type === "quid_pro_quo_75" && !row.quidProQuoDescription?.trim();
                      const result = results?.find((r) => r.ackId === row.ackId);
                      const alreadyGenerated = generatedByAckId.has(row.ackId);

                      return (
                        <tr key={row.ackId} className="hover:bg-gray-50">
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selected.has(row.ackId)}
                              onChange={() => toggle(row.ackId)}
                              aria-label={`Select ${row.donor?.name ?? "row with no donor linked"}`}
                              className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                            />
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-600">
                            {formatYMD(row.txnDate)}
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-700">
                            {row.donor ? (
                              <div className="font-medium">{row.donor.name}</div>
                            ) : (
                              <span className="text-gray-400 text-xs italic">No donor linked</span>
                            )}
                            {blocked && (
                              <div className="mt-0.5 text-xs font-medium text-amber-700">{blocked}</div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-right text-sm font-medium tabular-nums text-green-700">
                            {formatBudgetReferenceCents(row.amountCents)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-xs text-gray-500">
                            {ackTypeLabel(row.type)}
                            {missingQpqDescription && (
                              <div className="mt-0.5 whitespace-normal text-amber-700">
                                No description on file — letter will read &ldquo;goods or
                                services&rdquo;
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-4 text-xs">
                            {result ? (
                              result.status === "generated" ? (
                                <span className="inline-flex items-center rounded-lg px-2 py-0.5 font-semibold bg-green-50 text-green-700 border border-green-200">
                                  Generated
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-lg px-2 py-0.5 font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                  Skipped — {result.reason}
                                </span>
                              )
                            ) : alreadyGenerated ? (
                              <span className="inline-flex items-center rounded-lg px-2 py-0.5 font-semibold bg-blue-50 text-lions-blue border border-blue-200">
                                Letter ready
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {results && (
              <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-900">
                <p className="font-semibold">
                  {results.filter((r) => r.status === "generated").length} of {results.length} letter
                  {results.length !== 1 ? "s" : ""} generated
                  {results.some((r) => r.status === "skipped")
                    ? ` — ${results.filter((r) => r.status === "skipped").length} skipped.`
                    : "."}
                </p>
                {results.some((r) => r.status === "skipped") && (
                  <ul className="mt-2 list-disc pl-5 space-y-0.5">
                    {results
                      .filter((r) => r.status === "skipped")
                      .map((r) => {
                        const row = rowsById.get(r.ackId);
                        return (
                          <li key={r.ackId}>
                            {row?.donor?.name ?? "This gift"} — {r.reason}
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            )}

            {printableLetters.length > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-2 border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  <span aria-hidden="true">🖨️</span>
                  Print / Save as PDF ({printableLetters.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Generate ${selected.size} letters?`}
        description={`This will overwrite any unsent draft letters for the ${selected.size} selected gifts. Already-sent letters (marked "Sent") are never touched — regeneration is refused for those.`}
        confirmLabel={`Generate ${selected.size} Letters`}
        onConfirm={() => {
          setConfirmOpen(false);
          runGenerate();
        }}
      />

      <AcknowledgmentLettersPrint letters={printableLetters} />
    </>
  );
}
