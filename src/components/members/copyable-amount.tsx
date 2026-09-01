"use client";

import { toast } from "sonner";

/**
 * Renders a formatted dollar string that copies itself to the clipboard on
 * click — double-clicking "$17,927.83" to select it only grabs part of the
 * number in most browsers (the "$" and "," break word boundaries), so a
 * click-drag was the only way to copy a report figure before this existed.
 */
export default function CopyableAmount({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  async function handleClick() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Copied ${value}`);
    } catch {
      toast.error("Couldn't copy — your browser may not allow clipboard access here.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`hover:bg-lions-blue/10 rounded px-1 -mx-1 transition-colors print:pointer-events-none focus:outline-none focus:ring-2 focus:ring-lions-blue ${className ?? ""}`}
      title={`Copy ${value}`}
    >
      {value}
    </button>
  );
}
