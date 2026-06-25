/**
 * FilingsCalendar — Server Component
 *
 * Renders compliance filings in three bands: Overdue / Upcoming / Filed.
 * Each band uses a card-per-filing layout at all widths (never a horizontal
 * scroll table — mobile constraint from Phase 1 analyst + tech-lead).
 *
 * At sm+ breakpoints the layout gains a subtle grid structure via CSS Grid
 * with named columns, but the content remains card-based, not tabular.
 */

import type { FilingRow } from "@/lib/ledger-queries";
import MarkFiledDialog from "@/components/admin/ledger/mark-filed-dialog";
import DeleteFilingButton from "@/components/admin/ledger/delete-filing-button";
import FilingFormDialog from "@/components/admin/ledger/filing-form-dialog";

interface FilingsCalendarProps {
  filings: FilingRow[];
  entityId: string;
  fiscalYear: number;
  canRecord: boolean;
  canManage: boolean;
}

// ---- helpers ----------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusBadge({ status, overdue }: { status: string; overdue: boolean }) {
  if (overdue) {
    return (
      <span className="inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
        Overdue
      </span>
    );
  }
  const map: Record<string, string> = {
    not_started: "bg-gray-100 text-gray-600 border border-gray-200",
    in_progress: "bg-blue-50 text-lions-blue border border-blue-200",
    filed: "bg-green-50 text-green-700 border border-green-200",
    future: "bg-gray-50 text-gray-400 border border-gray-200",
    na: "bg-gray-50 text-gray-500 border border-gray-200",
  };
  const labels: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    filed: "Filed",
    future: "Future",
    na: "N/A",
  };
  const cls = map[status] ?? "bg-gray-50 text-gray-500 border border-gray-200";
  const label = labels[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function AgencyBadge({ agency }: { agency: string }) {
  // Keyed on the agency strings actually seeded in 0048_ledger_compliance.sql.
  const colors: Record<string, string> = {
    IRS: "bg-purple-50 text-purple-700",
    "Ohio Attorney General": "bg-orange-50 text-orange-700",
    "Ohio Secretary of State": "bg-teal-50 text-teal-700",
    "Ohio Dept. of Commerce": "bg-yellow-50 text-yellow-700",
    "Internal — Audit Committee": "bg-gray-100 text-gray-600",
  };
  const cls = colors[agency] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>
      {agency}
    </span>
  );
}

// ---- filing card ------------------------------------------------------------

function FilingCard({
  filing,
  canRecord,
  canManage,
}: {
  filing: FilingRow;
  canRecord: boolean;
  canManage: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      {/* Top row: agency + recurrence badge */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <AgencyBadge agency={filing.agency} />
          {filing.recurrence === "5_year" && (
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-600">
              5-year
            </span>
          )}
        </div>
        {/* Status badge on the right */}
        <StatusBadge status={filing.status} overdue={filing.overdue} />
      </div>

      {/* Title + due date */}
      <h3 className="font-semibold text-gray-900 text-sm">{filing.title}</h3>
      <p className="text-xs text-gray-500 mt-0.5">
        Due{" "}
        <time dateTime={filing.dueDate.toISOString().slice(0, 10)}>
          {formatDate(filing.dueDate)}
        </time>
      </p>

      {/* Confirmation # and filed date (when filed) */}
      {filing.status === "filed" && (
        <div className="mt-2 text-xs text-gray-500 space-y-0.5">
          {filing.filedOn && (
            <p>
              Filed:{" "}
              <span className="text-gray-700 font-medium">
                {new Date(filing.filedOn + "T00:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </p>
          )}
          {filing.confirmation && (
            <p>
              Conf #:{" "}
              <span className="text-gray-700 font-medium font-mono">{filing.confirmation}</span>
            </p>
          )}
        </div>
      )}

      {/* Note */}
      {filing.note && (
        <p className="mt-2 text-xs text-gray-400 italic line-clamp-2">{filing.note}</p>
      )}

      {/* Actions */}
      {(canRecord || canManage) && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {canRecord && filing.status !== "filed" && filing.status !== "na" && (
            <MarkFiledDialog filing={filing}>
              <button
                type="button"
                className="bg-lions-blue text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[36px]"
              >
                Update status
              </button>
            </MarkFiledDialog>
          )}

          {/* Allow un-filing (mark as in-progress) for filed rows */}
          {canRecord && filing.status === "filed" && (
            <MarkFiledDialog filing={filing}>
              <button
                type="button"
                className="border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[36px]"
              >
                Edit / correct
              </button>
            </MarkFiledDialog>
          )}

          {canManage && (
            <DeleteFilingButton filing={filing} />
          )}
        </div>
      )}
    </div>
  );
}

// ---- band -------------------------------------------------------------------

function Band({
  label,
  color,
  filings,
  canRecord,
  canManage,
  emptyText,
}: {
  label: string;
  color: string;
  filings: FilingRow[];
  canRecord: boolean;
  canManage: boolean;
  emptyText: string;
}) {
  return (
    <section aria-label={label}>
      <div className={`flex items-center gap-2 mb-3`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{label}</h2>
        <span className="text-xs text-gray-400">({filings.length})</span>
      </div>

      {filings.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-8 text-center text-gray-500 text-sm">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filings.map((f) => (
            <FilingCard
              key={f.id}
              filing={f}
              canRecord={canRecord}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---- main export ------------------------------------------------------------

export default function FilingsCalendar({
  filings,
  entityId,
  fiscalYear,
  canRecord,
  canManage,
}: FilingsCalendarProps) {
  const overdue = filings.filter((f) => f.overdue);
  const upcoming = filings.filter(
    (f) => !f.overdue && !["filed", "na"].includes(f.status)
  );
  const filed = filings.filter((f) => f.status === "filed" || f.status === "na");

  return (
    <div className="space-y-8">
      {/* Admin: add filing button */}
      {canManage && (
        <div className="flex justify-end">
          <FilingFormDialog entityId={entityId} fiscalYear={fiscalYear}>
            <button
              type="button"
              className="bg-lions-blue text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] text-sm"
            >
              + Add Filing
            </button>
          </FilingFormDialog>
        </div>
      )}

      {/* Overdue band */}
      <Band
        label="Overdue"
        color="bg-red-500"
        filings={overdue}
        canRecord={canRecord}
        canManage={canManage}
        emptyText="No overdue filings."
      />

      {/* Upcoming band */}
      <Band
        label="Upcoming"
        color="bg-yellow-400"
        filings={upcoming}
        canRecord={canRecord}
        canManage={canManage}
        emptyText="No upcoming filings."
      />

      {/* Filed / N/A band */}
      <Band
        label="Filed / N/A"
        color="bg-green-500"
        filings={filed}
        canRecord={canRecord}
        canManage={canManage}
        emptyText="No filed filings yet."
      />
    </div>
  );
}
