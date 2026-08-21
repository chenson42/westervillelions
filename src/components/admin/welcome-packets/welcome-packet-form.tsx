"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface WelcomePacketFormProps {
  mode: "create" | "edit";
  /** Required for mode="edit" — the record being edited. */
  packet?: {
    id: string;
    lionsYear: string;
    rawHtml: string;
  };
}

/**
 * The admin create/edit form for a welcome packet — a Lions Year label and
 * one large raw-HTML textarea, per DECISION-090 point 4: no rich-text
 * editor, this is a documented exception. The admin pastes the whole
 * updated file's contents in; there is no partial/section editing.
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "Admin UI — exact plan" / "WelcomePacketForm — the two fields".
 *
 * `"use client"` — fetch, component state, router navigation — same
 * fetch-and-toast idiom as `document-version-form.tsx` /
 * `pending-versions-panel.tsx`.
 *
 * On create: POSTs to /api/admin/welcome-packets, and on success navigates
 * to the edit view of the row just created (where "Mark as current" lives)
 * rather than back to the list.
 *
 * On edit: PATCHes /api/admin/welcome-packets/[id] — edits happen in place
 * (Phase 3 (Revised) "Edit-in-place vs. fresh-row"), so there is nothing to
 * navigate to afterward; the page stays put and router.refresh() picks up
 * the new "Last updated" timestamp.
 *
 * A 400 response surfaces extractPacketParts()'s own specific
 * missing-anchor message verbatim via toast.error(data.error) — the admin
 * sees exactly which anchor is missing, not a generic "save failed."
 */
export function WelcomePacketForm({ mode, packet }: WelcomePacketFormProps) {
  const router = useRouter();
  const labelId = useId();
  const htmlId = useId();

  const [lionsYear, setLionsYear] = useState(packet?.lionsYear ?? "");
  const [rawHtml, setRawHtml] = useState(packet?.rawHtml ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lionsYear.trim() || !rawHtml.trim()) {
      toast.error("Lions Year and the packet HTML are both required.");
      return;
    }

    setSubmitting(true);
    try {
      const url = mode === "create" ? "/api/admin/welcome-packets" : `/api/admin/welcome-packets/${packet!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lionsYear: lionsYear.trim(), rawHtml }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to save this welcome packet.");
      }

      if (mode === "create") {
        const data = await res.json();
        toast.success("Packet created. Review it below, then mark it current when it's ready.");
        router.push(`/admin/welcome-packets/${data.id}`);
      } else {
        toast.success("Saved.");
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save this welcome packet.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-white shadow-sm p-6">
      <div>
        <label htmlFor={labelId} className="block text-sm font-medium text-gray-700 mb-1">
          Lions Year
        </label>
        <input
          id={labelId}
          type="text"
          value={lionsYear}
          onChange={(e) => setLionsYear(e.target.value)}
          disabled={submitting}
          placeholder="2027-28"
          pattern="\d{4}-\d{2}"
          className="block w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 min-h-[44px]"
        />
        <p className="mt-1 text-xs text-gray-500">Format &ldquo;YYYY-YY&rdquo;, e.g. &ldquo;2027-28&rdquo;.</p>
      </div>

      <div>
        <label htmlFor={htmlId} className="block text-sm font-medium text-gray-700 mb-1">
          Packet HTML
        </label>
        <p className="mb-2 text-xs text-gray-500">
          Paste the entire packet file&apos;s contents — the &lt;title&gt;, &lt;style&gt; block, and{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">&lt;div class=&quot;deck&quot;&gt;</code>. This is a raw
          HTML field with no rich-text editor by design (DECISION-090) — there is no partial edit; replace the whole
          file&apos;s contents each time.
        </p>
        <textarea
          id={htmlId}
          value={rawHtml}
          onChange={(e) => setRawHtml(e.target.value)}
          disabled={submitting}
          rows={20}
          spellCheck={false}
          placeholder="<title>...</title>&#10;<style>...</style>&#10;<div class=&quot;deck&quot;>...</div>"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        {submitting ? "Saving…" : mode === "create" ? "Create Packet" : "Save Changes"}
      </button>
    </form>
  );
}
