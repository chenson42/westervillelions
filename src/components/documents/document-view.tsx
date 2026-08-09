import RichMarkdownContent from "@/components/rich-markdown-content";

export interface DocumentViewData {
  title: string;
  versionNumber: number;
  bodyMarkdown: string;
  createdAt: Date | string;
}

function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Current-text display — title, version metadata, the rendered body via the
 * promoted `RichMarkdownContent` (never `ReleaseNotesViewer`'s `rehype-raw`
 * pipeline — DECISION-076 Ruling 3). Shared, unmodified, by the member page
 * (`/members/records/documents/[slug]`) and the admin detail page
 * (`/admin/documents/[slug]`) so the two can never structurally diverge —
 * same "shared, can't structurally diverge" reasoning as `MinutesDetail`.
 *
 * A pure Server Component — no hooks, no client-only APIs.
 *
 * The "Current" badge is deliberate and load-bearing (Phase 4 requirement
 * 5 — "make which text is operative right now unmistakable"): this
 * component is ONLY ever handed the document's live current version, never
 * a superseded or pending one, so the badge is always true by construction,
 * not a claim the caller could get wrong.
 */
export function DocumentView({ data }: { data: DocumentViewData }) {
  return (
    <div className="space-y-4">
      <div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
          <span aria-hidden="true">●</span> Current — the club&apos;s operative text
        </span>
        <p className="mt-2 text-sm text-gray-500">
          Version {data.versionNumber} — in effect since {formatDate(data.createdAt)}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          This is the club&apos;s governing text of record. Earlier versions remain
          viewable in the history for reference.
        </p>
      </div>
      <div className="rounded-2xl bg-white shadow-sm p-6 sm:p-8">
        <RichMarkdownContent>{data.bodyMarkdown}</RichMarkdownContent>
      </div>
    </div>
  );
}
