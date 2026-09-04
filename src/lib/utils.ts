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

/**
 * Human-readable file size, e.g. 2_900_000 -> "2.9 MB". Shared by every
 * Club Files surface (admin list/detail, member Files page) rather than
 * copy-pasted per component.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
