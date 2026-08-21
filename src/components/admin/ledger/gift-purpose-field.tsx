"use client";

import { GIFT_PURPOSE_MAX_LENGTH } from "@/lib/ledger";

interface GiftPurposeFieldProps {
  /** DOM id — the two dialogs can be mounted at the same time, so it must be caller-supplied. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The "what this gift was for" input, shared by AcknowledgeDialog (typed at
 * creation) and GiftPurposeDialog (edited before the letter is sent).
 *
 * Extracted rather than copy-pasted because the helper text below is not
 * decoration: it is the only place the treasurer sees that this text becomes
 * DONOR-FACING PROSE inside a tax receipt, quoted in the exact sentence it
 * lands in. Two copies of that warning would be two copies to drift, and the
 * copy that drifts is the one that stops saying "the donor reads this".
 *
 * The preview is deliberately a live echo of what was typed — the treasurer
 * proofreads the sentence, not the field.
 */
export default function GiftPurposeField({
  id,
  value,
  onChange,
  disabled,
}: GiftPurposeFieldProps) {
  const trimmed = value.trim();
  const example = "the 2026 Rudolph Run";

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        What this gift was for{" "}
        <span className="text-gray-400 font-normal">(optional)</span>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={GIFT_PURPOSE_MAX_LENGTH}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 py-2 px-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:bg-gray-50 disabled:text-gray-500"
        placeholder={`e.g., ${example}`}
      />
      <p className="mt-1 text-xs text-gray-500">
        The donor reads this in their letter:{" "}
        <span className="text-gray-700">
          &ldquo;&hellip;received a cash contribution of $500.00 from you in support of{" "}
          <strong className="font-semibold">{trimmed || example}</strong>.&rdquo;
        </span>{" "}
        Leave blank to omit the phrase entirely.
      </p>
    </div>
  );
}
