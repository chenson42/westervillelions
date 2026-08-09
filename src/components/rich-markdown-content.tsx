import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared Markdown renderer — promoted (not cloned) from
 * `src/components/admin/ledger/budget-notes-markdown.tsx` (DECISION-074
 * Ruling 2, docs/work-log/2026-08-08-meeting-minutes.md Phase 3 Component
 * Plan / Implementation Order step 5). Neutral, non-domain-named on purpose:
 * it now has FOUR real call sites, not the two the architect originally
 * counted (DECISION-073 had already added a third before DECISION-074 was
 * written; a fourth followed in the same file) —
 *   - src/components/admin/ledger/budget-notes-editor.tsx (on-screen budget
 *     notes display)
 *   - src/components/admin/ledger/budget-print-worksheet.tsx (printed board
 *     worksheet)
 *   - src/components/admin/ledger/acknowledgment-letters-print.tsx (printed
 *     donor acknowledgment letters)
 *   - src/components/admin/ledger/ledger-acknowledgment-template-form.tsx
 *     (on-screen letter template preview)
 *   - src/components/minutes/minutes-detail.tsx (member-facing minutes
 *     discussion body — Meeting Minutes, 2026-08-08-meeting-minutes.md)
 *   - src/components/admin/minutes/minutes-body-editor.tsx (admin live
 *     preview while pasting/editing minutes discussion notes)
 *
 * Markdown only — deliberately NO rehype-raw / raw-HTML passthrough. This
 * invariant travels with the file verbatim on every promotion/clone: notes,
 * minutes, and letters are all admin/notetaker-authored, but there is no
 * reason to let arbitrary HTML into a document that also gets handed to the
 * board (as a PDF) or to the whole membership (as a member-portal page).
 *
 * Drops "use client" on promotion — the original had no hooks/state/event
 * handlers (confirmed by reading it before the move), so this renders
 * server-side cleanly. That is a real, intentional win the architect flagged
 * as a possible outcome (Phase 2 Ruling 2): it keeps every Server Component
 * caller — including the member-facing minutes detail page — a pure Server
 * Component end to end, with zero client-bundle cost for this renderer.
 *
 * Legacy-data note: notes written before this component existed are plain
 * text — paragraphs separated by blank lines, some using a literal "•"
 * character as a bullet prefix (not Markdown "-"/"*" list syntax).
 * remark-gfm renders that acceptably: each blank-line-separated block
 * becomes its own <p>, and the "•" glyph is preserved as ordinary text at
 * the start of the line, so it still reads as a bulleted list even though
 * it isn't a real Markdown list. See rich-markdown-content.test.tsx for the
 * render-shape assertion.
 */
export default function RichMarkdownContent({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`text-sm leading-relaxed break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mb-1 mt-3 text-base font-bold first:mt-0">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="mb-1 mt-3 text-sm font-bold first:mt-0">{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h5>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-lions-blue underline hover:text-lions-blue-dark"
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              {children}
            </a>
          ),
          // list-disc/list-decimal default to outside marker position — keeps
          // bullets/numbers from being clipped by a narrow print column,
          // unlike list-inside.
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto print:overflow-visible">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 bg-gray-50 px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-2 py-1 align-top">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-4 border-gray-300 pl-3 italic text-gray-600">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-gray-300" />,
          code: ({ children }) => (
            <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{children}</code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
