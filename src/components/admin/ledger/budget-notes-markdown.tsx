"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared Markdown renderer for the budget-level "Notes & Assumptions" field
 * (`ledger_budget_notes.notes`) — used by BOTH render sites so they can never
 * structurally diverge in how the same stored text looks:
 *   - budget-notes-editor.tsx  (on-screen, view-only display for users who
 *     can't edit)
 *   - budget-print-worksheet.tsx (the printed/mailed board document)
 *
 * Markdown only — deliberately NO rehype-raw / raw-HTML passthrough. Notes
 * are admin-authored, but there's no reason to let arbitrary HTML into a
 * document that also gets handed to the board as a PDF.
 *
 * Legacy-data note: notes written before this change are plain text —
 * paragraphs separated by blank lines, some using a literal "•" character as
 * a bullet prefix (not Markdown "-"/"*" list syntax). remark-gfm renders
 * that acceptably: each blank-line-separated block becomes its own <p>, and
 * the "•" glyph is preserved as ordinary text at the start of the line, so
 * it still reads as a bulleted list even though it isn't a real Markdown
 * list. See budget-notes-markdown.test.tsx for the render-shape assertion.
 */
export default function BudgetNotesMarkdown({
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
