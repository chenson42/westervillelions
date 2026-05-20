import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names using clsx + tailwind-merge.
 * Resolves Tailwind class conflicts intelligently (e.g. px-2 px-4 → px-4).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
