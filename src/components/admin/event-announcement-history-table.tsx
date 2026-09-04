import type { AnnouncementHistoryBatch } from "@/lib/event-announcements-queries";

interface EventAnnouncementHistoryTableProps {
  history: AnnouncementHistoryBatch[];
}

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatOccurrenceDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Plain, presentational — no interactivity, no "use client". One row per
 * batch: timestamp, sender, scope/occurrence, "N of M emailed," failures if
 * any. See docs/work-log/2026-09-04-event-announcement-emails.md, Phase 3
 * "Component / Page Plan".
 */
export function EventAnnouncementHistoryTable({ history }: EventAnnouncementHistoryTableProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 px-4 sm:px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Announcement history</h2>
        <p className="text-sm text-gray-500">Every past send for this event, newest first.</p>
      </div>

      {history.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 m-4">
          No announcements sent yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 sm:px-6 py-2">Sent</th>
                <th className="px-4 sm:px-6 py-2">Scope</th>
                <th className="px-4 sm:px-6 py-2">By</th>
                <th className="px-4 sm:px-6 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map((batch) => (
                <tr key={batch.batchId}>
                  <td className="px-4 sm:px-6 py-3 whitespace-nowrap text-gray-900">
                    {formatSentAt(batch.sentAt)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 text-gray-700">
                    {batch.scope === "series" ? (
                      "Whole series"
                    ) : batch.occurrenceDate ? (
                      formatOccurrenceDate(batch.occurrenceDate)
                    ) : (
                      "Single occurrence"
                    )}
                    {batch.note && (
                      <span className="block text-xs text-gray-400 truncate max-w-xs" title={batch.note}>
                        Note: {batch.note}
                      </span>
                    )}
                  </td>
                  <td className="px-4 sm:px-6 py-3 text-gray-700">{batch.sentByName ?? "Unknown"}</td>
                  <td className="px-4 sm:px-6 py-3">
                    {batch.failureCount === 0 ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Emailed {batch.successCount} of {batch.recipientCount}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        Emailed {batch.successCount} of {batch.recipientCount} — {batch.failureCount} failed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
