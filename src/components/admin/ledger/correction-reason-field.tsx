"use client";

import { normalizeCorrectionReason } from "@/lib/ledger-correction";

interface CorrectionReasonFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  disabled?: boolean;
  label?: string;
  helpText?: string;
}

/**
 * Required free-text reason for a ledger correction (move or delete). Shows a
 * live character count against the limits from ledger-correction.ts and scrolls
 * itself into view on focus so a phone keyboard never hides it.
 */
export default function CorrectionReasonField({
  id,
  value,
  onChange,
  min,
  max,
  disabled = false,
  label = "Reason",
  helpText = "Why is this being corrected? The board can read this on the Compliance page.",
}: CorrectionReasonFieldProps) {
  const count = Array.from(value.trim()).length;
  const check = normalizeCorrectionReason(value);
  const tooShort = count > 0 && count < min;
  const tooLong = count > max;
  const helpId = `${id}-help`;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {label} <span className="text-red-600" aria-hidden="true">*</span>
        <span className="sr-only"> (required)</span>
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          const el = e.currentTarget;
          try {
            el.scrollIntoView?.({ block: "center", behavior: "smooth" });
          } catch {
            // scrollIntoView is a nicety; never block typing on it.
          }
        }}
        disabled={disabled}
        rows={3}
        required
        aria-describedby={helpId}
        aria-invalid={!check.ok && count > 0}
        className="w-full min-h-[88px] rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-lions-blue disabled:opacity-60"
      />
      <div id={helpId} className="mt-1 flex items-start justify-between gap-3 text-xs">
        <span className={tooShort || tooLong ? "text-red-600" : "text-gray-500"}>
          {tooShort
            ? `At least ${min} characters (${min - count} more).`
            : tooLong
              ? `At most ${max} characters.`
              : helpText}
        </span>
        <span className="text-gray-400 tabular-nums whitespace-nowrap">
          {count}/{max}
        </span>
      </div>
    </div>
  );
}
