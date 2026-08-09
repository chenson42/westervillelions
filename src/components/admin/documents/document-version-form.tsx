"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MinutesBodyEditor } from "@/components/admin/minutes/minutes-body-editor";

interface DocumentVersionFormProps {
  slug: string;
  /** Prefills the editor with the current text so a notetaker edits FROM
   *  the operative version rather than starting blank — empty string for a
   *  never-published document (the very first save). */
  initialBodyMarkdown: string;
}

/**
 * The admin version-save form — paste-to-Markdown editor (reusing the
 * already-approved `turndown`/`turndown-plugin-gfm` pipeline verbatim, see
 * `MinutesBodyEditor`), the editorial/substantive change-type choice, and
 * the required change note. POSTs to
 * `POST /api/admin/documents/[slug]/versions`.
 *
 * Phase 4 requirement 3 — "make that choice legible: a treasurer should
 * understand which he is doing without reading documentation." The
 * editorial/substantive picker is rendered as two full description cards,
 * not a bare `<select>`, specifically so the consequence of each choice
 * (current immediately vs. pending until a vote) is visible at the moment
 * of choosing, not buried in a tooltip.
 *
 * `"use client"` — clipboard events (via `MinutesBodyEditor`), fetch, and
 * component state — same client boundary DECISION-074 Ruling 1 already
 * drew for the minutes body editor, reused verbatim, not re-litigated.
 */
export function DocumentVersionForm({ slug, initialBodyMarkdown }: DocumentVersionFormProps) {
  const router = useRouter();
  const noteId = useId();
  const [changeType, setChangeType] = useState<"editorial" | "substantive">("editorial");
  const [bodyMarkdown, setBodyMarkdown] = useState(initialBodyMarkdown);
  const [changeNote, setChangeNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bodyMarkdown.trim() || !changeNote.trim()) {
      toast.error("Document text and a change note are both required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/documents/${slug}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeType, bodyMarkdown, changeNote: changeNote.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to save this version.");
      }
      const result = await res.json();
      toast.success(
        result.isCurrent
          ? "Saved — this is now the club's current text."
          : "Saved as a pending amendment — members won't see it until it's adopted.",
      );
      setChangeNote("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save this version.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-white shadow-sm p-6">
      <div>
        <span className="block text-sm font-medium text-gray-700 mb-2">What kind of change is this?</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setChangeType("editorial")}
            aria-pressed={changeType === "editorial"}
            className={`rounded-lg border-2 p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
              changeType === "editorial" ? "border-lions-blue bg-lions-blue/5" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <p className="font-semibold text-gray-900">Editorial</p>
            <p className="mt-1 text-xs text-gray-600">
              Fixes typos, formatting, or clarifies existing wording without changing what the by-laws require.
              Becomes the club&apos;s current text immediately — no vote needed.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setChangeType("substantive")}
            aria-pressed={changeType === "substantive"}
            className={`rounded-lg border-2 p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
              changeType === "substantive" ? "border-lions-blue bg-lions-blue/5" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <p className="font-semibold text-gray-900">Substantive</p>
            <p className="mt-1 text-xs text-gray-600">
              Changes what the by-laws actually require — dues, terms, procedures, amendments. Stays pending until
              the board adopts it by vote; members won&apos;t see it until then.
            </p>
          </button>
        </div>
      </div>

      <MinutesBodyEditor value={bodyMarkdown} onChange={setBodyMarkdown} disabled={submitting} />

      <div>
        <label htmlFor={noteId} className="block text-sm font-medium text-gray-700 mb-1">
          Change note (required) — what changed and why
        </label>
        <textarea
          id={noteId}
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          rows={2}
          disabled={submitting}
          placeholder='e.g. "Corrected the dues figure in Article VII to match the amount set by the board."'
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        {submitting ? "Saving…" : changeType === "editorial" ? "Publish this version" : "Save as pending amendment"}
      </button>
    </form>
  );
}
