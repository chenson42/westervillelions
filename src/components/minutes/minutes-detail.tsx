import { minutesKindLabel } from "@/lib/minutes";
import RichMarkdownContent from "@/components/rich-markdown-content";

export interface MinutesDetailMotionRow {
  id: string;
  text: string;
  moverName: string;
  seconderName: string | null;
  result: string;
}

export interface MinutesDetailActionItemRow {
  id: string;
  text: string;
  ownerName: string;
  dueDate: string | null;
}

export interface MinutesDetailData {
  id: string;
  kind: string;
  meetingDate: string;
  status: string;
  title: string | null;
  presentCount: number | null;
  notetakerNameSnapshot: string | null;
  bodyMarkdown: string | null;
  approvedAt: Date | string | null;
  motions: MinutesDetailMotionRow[];
  actionItems: MinutesDetailActionItemRow[];
}

function formatMeetingDate(dateStr: string): string {
  // meetingDate is a plain "YYYY-MM-DD" column — parse as a calendar date,
  // never through `new Date(string)` directly (that reads it as UTC
  // midnight and can roll back a day in US timezones).
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function resultBadgeClass(result: string): string {
  if (result === "passed") return "bg-green-100 text-green-800";
  if (result === "failed") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-700"; // tabled / withdrawn / unknown
}

/**
 * Full display of one minutes record — attendance, motions, action items,
 * and the rendered discussion body. Shared verbatim by the member-facing
 * detail page (src/app/members/records/[id]/page.tsx) and the admin
 * read-only view of an approved record ([id]/page.tsx under /admin/minutes)
 * so the two can never structurally diverge.
 *
 * A pure Server Component — no hooks, no client-only APIs, so it never
 * forces a client boundary on either caller. It imports RichMarkdownContent
 * (also promoted to server-safe, DECISION-074 Ruling 2) for the discussion
 * body, keeping the member-facing read path a pure Server Component
 * end-to-end.
 */
export function MinutesDetail({ minutes }: { minutes: MinutesDetailData }) {
  const heading = minutes.title || `${minutesKindLabel(minutes.kind)} Minutes — ${formatMeetingDate(minutes.meetingDate)}`;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="inline-flex items-center rounded-full bg-lions-blue/10 px-2.5 py-0.5 text-xs font-semibold text-lions-blue">
            {minutesKindLabel(minutes.kind)}
          </span>
          {minutes.status === "draft" ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              Draft — not yet approved
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
              Approved
            </span>
          )}
        </div>
        <h2 className="text-2xl font-bold text-gray-900">{heading}</h2>
        <p className="text-gray-600">{formatMeetingDate(minutes.meetingDate)}</p>
        <p className="mt-1 text-sm text-gray-500">
          Recorded by{" "}
          {minutes.notetakerNameSnapshot ? (
            <span className="font-medium text-gray-700">{minutes.notetakerNameSnapshot}</span>
          ) : (
            <span className="italic">not recorded</span>
          )}
        </p>
      </div>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">Attendance</h3>
        {minutes.presentCount === null ? (
          <p className="text-sm text-gray-400">No attendance count recorded.</p>
        ) : (
          <p className="text-sm text-gray-800">
            {minutes.presentCount} {minutes.presentCount === 1 ? "person" : "people"} present
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">Motions</h3>
        {minutes.motions.length === 0 ? (
          <p className="text-sm text-gray-400">No motions recorded.</p>
        ) : (
          <ul className="space-y-3">
            {minutes.motions.map((m) => (
              <li key={m.id} className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm text-gray-900">{m.text}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Moved by {m.moverName}
                  {m.seconderName ? `, seconded by ${m.seconderName}` : ""}
                  {" — "}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${resultBadgeClass(m.result)}`}
                  >
                    {m.result.charAt(0).toUpperCase() + m.result.slice(1)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">Action items</h3>
        {minutes.actionItems.length === 0 ? (
          <p className="text-sm text-gray-400">No action items recorded.</p>
        ) : (
          <ul className="space-y-2">
            {minutes.actionItems.map((a) => (
              <li key={a.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                <p className="text-gray-900">{a.text}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Owner: {a.ownerName}
                  {a.dueDate ? ` — due ${a.dueDate}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">Discussion</h3>
        {minutes.bodyMarkdown && minutes.bodyMarkdown.trim() ? (
          <RichMarkdownContent>{minutes.bodyMarkdown}</RichMarkdownContent>
        ) : (
          <p className="text-sm text-gray-400">No discussion notes recorded.</p>
        )}
      </section>
    </div>
  );
}
