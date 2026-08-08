import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names using clsx + tailwind-merge.
 * Resolves Tailwind class conflicts intelligently (e.g. px-2 px-4 → px-4).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a flat list of email addresses (e.g. a donor's `emails`) for
 * compact display: up to `max` addresses joined with commas, anything
 * beyond that collapses into a "+N more" suffix. Returns null for an
 * empty/missing list so callers can render their own empty state.
 */
export function formatEmailList(emails: string[] | null | undefined, max = 2): string | null {
  const list = emails ?? [];
  if (list.length === 0) return null;
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max} more`;
}
