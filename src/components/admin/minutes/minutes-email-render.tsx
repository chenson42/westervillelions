/**
 * Meeting Minutes — email HTML renderer.
 *
 * SERVER-ONLY. This is NOT a page/UI component and is never rendered by
 * Next.js's router — nothing imports it from a page. It lives under
 * `src/components/admin/minutes/` only because the Phase 3 design doc placed
 * it there (docs/work-log/2026-08-08-meeting-minutes.md, "Component / Page
 * Plan"), matching the promoted `rich-markdown-content.tsx`'s own component
 * home. The sole export, `renderMinutesEmailHtml()`, is called once, from
 * `POST /api/admin/minutes/[id]/email` (src/app/api/admin/minutes/[id]/email/route.ts),
 * to produce a plain HTML string for `sendEmail()`.
 *
 * DECISION-075 (architect addendum) rulings this file implements:
 *   §1 — Markdown -> HTML via `renderToStaticMarkup()` (react-dom/server) over
 *        the SAME ReactMarkdown + remark-gfm engine the web renderer uses, no
 *        new dependency. Precedent for this technique working fine in
 *        Vitest's "node" environment (no jsdom needed — it only produces an
 *        HTML string) is already on record:
 *        src/components/admin/ledger/budget-notes-markdown.test.tsx — but
 *        that precedent is a *.test.tsx file, excluded from the production
 *        build entirely, and turned out NOT to transfer: Turbopack refuses a
 *        static top-level `import { renderToStaticMarkup } from
 *        "react-dom/server"` reachable from an App Route's module graph
 *        ("You're importing a component that imports react-dom/server...
 *        render or return the content directly as a Server Component
 *        instead"), even though this file is never a rendered
 *        page/component and the route itself is a plain Node API handler,
 *        not an RSC tree. `renderMinutesEmailHtml()` is therefore `async`
 *        and imports `react-dom/server` via a runtime `await import(...)`
 *        INSIDE the function body — Turbopack's static-import check doesn't
 *        trace dynamic imports, and this keeps DECISION-075 §1's "no new
 *        dependency" outcome intact rather than reaching for a second
 *        Markdown-to-HTML pipeline. Confirmed with `pnpm build:only`
 *        (production build) in addition to `pnpm test`. If a future React/
 *        Next upgrade changes this restriction, the dynamic import can
 *        safely revert to a static one — nothing else about this file
 *        depends on it being dynamic.
 *   §2 — A SEPARATE, inline-styled `components` map
 *        (`minutesEmailMarkdownComponents`), not the web renderer's
 *        Tailwind-classed one — mail clients strip class-based CSS. Matches
 *        this project's existing transactional-email convention (plain
 *        inline `style=` attributes, no Tailwind), read directly from
 *        `src/app/api/contact/route.ts`.
 *   §5 — Any email sent while `status !== 'approved'` carries an unmissable
 *        "DRAFT — subject to approval" banner in the body itself. Colored
 *        gold/amber (`#FFF8E1`/`#FFD700`), never `lions-red` (undefined in
 *        this project's theme, per CLAUDE.md).
 *
 * Only `bodyMarkdown` goes through ReactMarkdown — motions/action items are
 * structured facts rendered as plain inline-styled JSX above it, not
 * reformatted into Markdown first (there's no reason to round-trip
 * structured data through a text format only to parse it back out).
 * Attendance is a single headcount (`presentCount`, DECISION-079) rendered
 * as one line, not a roster. The notetaker of record (`notetakerNameSnapshot`
 * — further Phase 4 increment, 2026-08-09) renders as a second line right
 * under the meeting date, ahead of the sender's optional note — minutes
 * conventionally name their recorder near the top, not buried in the body.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MinutesEmailMotionRow {
  text: string;
  moverName: string;
  seconderName: string | null;
  result: string;
}

export interface MinutesEmailActionItemRow {
  text: string;
  ownerName: string;
  dueDate: string | null;
}

/** Only the fields the email actually renders — a narrower shape than the
 *  full `MinutesDetail` from `@/lib/minutes-queries`, kept independent so
 *  this file never has to import the DB-coupled query module. */
export interface MinutesEmailInput {
  kind: string;
  meetingDate: string;
  title: string | null;
  status: string;
  presentCount: number | null;
  notetakerNameSnapshot: string | null;
  bodyMarkdown: string | null;
  motions: MinutesEmailMotionRow[];
  actionItems: MinutesEmailActionItemRow[];
}

/** Exported so the email route (POST /api/admin/minutes/[id]/email) can use
 *  the identical capitalization for the email subject line as the body's own
 *  heading — one source of truth for "how a kind reads in a sentence". */
export function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// DECISION-075 §2 — inline styles only, no Tailwind classes. Kept
// deliberately plain/light, matching every other transactional email in
// this project (src/app/api/contact/route.ts,
// src/app/api/auth/forgot-password/route.ts).
const minutesEmailMarkdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ margin: "16px 0 8px", fontSize: "18px", fontWeight: "bold" }}>{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h4 style={{ margin: "14px 0 6px", fontSize: "16px", fontWeight: "bold" }}>{children}</h4>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h5 style={{ margin: "12px 0 4px", fontSize: "15px", fontWeight: "bold" }}>{children}</h5>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong style={{ fontWeight: "bold" }}>{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} style={{ color: "#1a56db", textDecoration: "underline" }}>
      {children}
    </a>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ margin: "0 0 10px", paddingLeft: "20px" }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ margin: "0 0 10px", paddingLeft: "20px" }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li style={{ marginBottom: "4px" }}>{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "10px" }}>{children}</table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th style={{ border: "1px solid #ccc", background: "#f5f5f5", padding: "6px 8px", textAlign: "left" }}>
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td style={{ border: "1px solid #ccc", padding: "6px 8px" }}>{children}</td>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote
      style={{ margin: "0 0 10px", paddingLeft: "12px", borderLeft: "4px solid #ccc", color: "#555" }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid #ccc" }} />,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code style={{ background: "#f0f0f0", padding: "1px 4px", borderRadius: "3px", fontSize: "13px" }}>
      {children}
    </code>
  ),
};

/**
 * Renders a minutes record as a plain HTML string for email. Pure function —
 * no DB access, no side effects. The DRAFT banner (DECISION-075 §5) is
 * included whenever `status !== 'approved'`; `note` (DECISION-075 §3, the
 * sender's optional short note) renders above the minutes content when
 * present.
 */
export async function renderMinutesEmailHtml(
  minutes: MinutesEmailInput,
  note?: string | null,
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const showDraftBanner = minutes.status !== "approved";

  const heading = minutes.title
    ? `${minutes.title} — ${capitalize(minutes.kind)} Minutes`
    : `${capitalize(minutes.kind)} Minutes`;

  const element = (
    <div style={{ fontFamily: "Arial, Helvetica, sans-serif", color: "#1a1a1a", fontSize: "14px", maxWidth: "640px" }}>
      {showDraftBanner && (
        <div
          style={{
            background: "#FFF8E1",
            border: "1px solid #FFD700",
            borderRadius: "6px",
            padding: "10px 14px",
            marginBottom: "16px",
            fontWeight: "bold",
          }}
        >
          DRAFT — subject to approval. This is not yet the club&apos;s official record.
        </div>
      )}

      <h2 style={{ margin: "0 0 4px", fontSize: "20px" }}>{heading}</h2>
      <p style={{ margin: "0 0 4px", color: "#555" }}>{minutes.meetingDate}</p>
      <p style={{ margin: "0 0 16px", color: "#555", fontSize: "13px" }}>
        Recorded by {minutes.notetakerNameSnapshot ?? "not recorded"}
      </p>

      {note && (
        <div style={{ margin: "0 0 16px", padding: "10px 14px", background: "#f5f7fb", borderRadius: "6px" }}>
          {note}
        </div>
      )}

      {minutes.presentCount !== null && (
        <div style={{ marginBottom: "16px" }}>
          <strong>Present:</strong> {minutes.presentCount}
        </div>
      )}

      {minutes.motions.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "16px", margin: "0 0 6px" }}>Motions</h3>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {minutes.motions.map((m, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>
                {m.text} — moved by {m.moverName}
                {m.seconderName ? `, seconded by ${m.seconderName}` : ""} — {m.result}
              </li>
            ))}
          </ul>
        </div>
      )}

      {minutes.actionItems.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "16px", margin: "0 0 6px" }}>Action Items</h3>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {minutes.actionItems.map((a, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>
                {a.text} — {a.ownerName}
                {a.dueDate ? ` (due ${a.dueDate})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {minutes.bodyMarkdown && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={minutesEmailMarkdownComponents}>
          {minutes.bodyMarkdown}
        </ReactMarkdown>
      )}
    </div>
  );

  return renderToStaticMarkup(element);
}
