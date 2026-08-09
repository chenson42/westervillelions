"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  composeAcknowledgmentLetter,
  type ComposeLetterEntity,
  type ComposeLetterTemplate,
} from "@/lib/ledger-acknowledgment-letter";
import type { LedgerLetterTemplate } from "@/lib/db/schema";
import RichMarkdownContent from "@/components/rich-markdown-content";

interface Props {
  template: LedgerLetterTemplate;
  entity: ComposeLetterEntity;
}

const SAMPLE_DONOR = { name: "Jane Donor", address: "123 Main St, Westerville, OH 43081" };

/** All five template fields blanked — composeAcknowledgmentLetter() still
 *  emits the full required block byte-for-byte (proven by the composer's own
 *  empty-template fuzz test). Diffing the real preview against THIS output
 *  is how the split below finds the required block without re-implementing
 *  or importing buildRequiredBlock() — which isn't exported (DECISION-072
 *  §2's whole point). */
const EMPTY_TEMPLATE: ComposeLetterTemplate = {
  greeting: "",
  bodyText: "",
  closing: "",
  signatureName: "",
  signatureTitle: "",
};

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FIELDS: Array<{
  key: keyof ComposeLetterTemplate;
  label: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}> = [
  { key: "greeting", label: "Greeting", hint: 'e.g. "Dear {{donorName}},"' },
  { key: "bodyText", label: "Thank-you message", multiline: true, rows: 6 },
  { key: "closing", label: "Closing", hint: 'e.g. "With gratitude,"' },
  { key: "signatureName", label: "Signature name" },
  { key: "signatureTitle", label: "Signature title" },
];

/**
 * The template editor's ENTIRE writable surface — five fields, PATCHed to
 * /api/admin/ledger/acknowledgments/letter-template (LEDGER_MANAGE). Live
 * preview calls composeAcknowledgmentLetter() directly, client-side, on
 * every keystroke — the SAME pure function the server calls at real
 * generation time, so there is no separate preview implementation that
 * could drift from what actually gets written (DECISION-072/073).
 *
 * The preview visually separates the treasurer's editable "warmth" text
 * from the generated, non-editable compliance paragraph by computing the
 * required block in isolation (composing against EMPTY_TEMPLATE) and
 * locating that exact substring inside the real composed output — not by
 * parsing Markdown or guessing where one starts and the other ends.
 */
export default function LedgerAcknowledgmentTemplateForm({ template, entity }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState<ComposeLetterTemplate>({
    greeting: template.greeting,
    bodyText: template.bodyText,
    closing: template.closing,
    signatureName: template.signatureName,
    signatureTitle: template.signatureTitle,
  });
  const [variant, setVariant] = useState<"written_ack_250" | "quid_pro_quo_75">("written_ack_250");
  const [saving, setSaving] = useState(false);

  const giftDate = useMemo(() => todayISODate(), []);

  const sampleAck = useMemo(
    () =>
      variant === "quid_pro_quo_75"
        ? {
            type: "quid_pro_quo_75" as const,
            amountCents: 50000,
            txnDate: giftDate,
            quidProQuoValueCents: 5000,
            quidProQuoDescription: "one Rudolph Run 5K entry",
          }
        : {
            type: "written_ack_250" as const,
            amountCents: 50000,
            txnDate: giftDate,
            quidProQuoValueCents: null,
            quidProQuoDescription: null,
          },
    [variant, giftDate],
  );

  const fullLetter = composeAcknowledgmentLetter({
    entity,
    donor: SAMPLE_DONOR,
    ack: sampleAck,
    template: fields,
  });
  const requiredOnly = composeAcknowledgmentLetter({
    entity,
    donor: SAMPLE_DONOR,
    ack: sampleAck,
    template: EMPTY_TEMPLATE,
  });

  const requiredIdx = fullLetter.indexOf(requiredOnly);
  const before = requiredIdx >= 0 ? fullLetter.slice(0, requiredIdx).trim() : fullLetter;
  const after = requiredIdx >= 0 ? fullLetter.slice(requiredIdx + requiredOnly.length).trim() : "";

  function update(key: keyof ComposeLetterTemplate, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ledger/acknowledgments/letter-template", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save the letter template.");
      }
      toast.success("Letter template saved.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the letter template. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Editor */}
      <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-sm p-6 space-y-4 h-fit">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label
              htmlFor={`ack-tpl-${f.key}`}
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {f.label}
            </label>
            {f.multiline ? (
              <textarea
                id={`ack-tpl-${f.key}`}
                value={fields[f.key]}
                onChange={(e) => update(f.key, e.target.value)}
                rows={f.rows ?? 4}
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue resize-y"
              />
            ) : (
              <input
                id={`ack-tpl-${f.key}`}
                type="text"
                value={fields[f.key]}
                onChange={(e) => update(f.key, e.target.value)}
                className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
              />
            )}
            {f.hint && <p className="mt-1 text-xs text-gray-400">{f.hint}</p>}
          </div>
        ))}

        <p className="text-xs text-gray-400">
          Available tokens:{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{{donorName}}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{{giftAmount}}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{{giftDate}}"}</code>{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{{clubName}}"}</code> — any other{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">{"{{...}}"}</code> is left as-is, so a
          typo will be obvious in the preview rather than silently dropped.
        </p>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
          >
            {saving ? "Saving…" : "Save Template"}
          </button>
        </div>
      </form>

      {/* Live preview */}
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4 h-fit">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
            Live Preview
          </h2>
          <div className="flex gap-1 rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              onClick={() => setVariant("written_ack_250")}
              className={`px-2.5 py-1.5 rounded text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                variant === "written_ack_250"
                  ? "bg-lions-blue text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Standard gift
            </button>
            <button
              type="button"
              onClick={() => setVariant("quid_pro_quo_75")}
              className={`px-2.5 py-1.5 rounded text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                variant === "quid_pro_quo_75"
                  ? "bg-lions-blue text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Quid pro quo (e.g. race entry)
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 space-y-4">
          {before && <RichMarkdownContent>{before}</RichMarkdownContent>}

          <div className="rounded-xl border-2 border-dashed border-lions-gold bg-amber-50 p-3">
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
              <span aria-hidden="true">🔒</span> Generated automatically — not editable here
            </p>
            <RichMarkdownContent className="text-gray-900">{requiredOnly}</RichMarkdownContent>
          </div>

          {after && <RichMarkdownContent>{after}</RichMarkdownContent>}
        </div>

        <p className="text-xs text-gray-400">
          This is exactly what will be generated — the preview uses the same composer as real
          letters, with a sample donor and sample gift ({entity.name}). The highlighted paragraph
          above is required by IRS Pub. 1771 and comes from each real gift&rsquo;s own amount,
          date, and entity — it can never be edited from this form.
        </p>
      </div>
    </div>
  );
}
