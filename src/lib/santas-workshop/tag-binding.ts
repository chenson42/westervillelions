/**
 * The sticker-binding decision (Phase 1 collision matrix), PURE: the query layer
 * gathers the target and the current holder, this decides. Client-safe.
 *
 * | Situation                                        | Decision                       |
 * |--------------------------------------------------|--------------------------------|
 * | unbound code, target has no sticker              | bind                           |
 * | bound to the same stuffy                         | noop (no history row)          |
 * | bound to another stuffy that is tagged/withdrawn | confirm_move, then move        |
 * | bound to another stuffy at checked_in or later   | holder_advanced (admin fixes)  |
 * | target already has a different sticker           | confirm_replace, then replace  |
 * | target past `tagged`                             | illegal                        |
 *
 * A code bound in ANOTHER session is invisible here (lookups are session-scoped),
 * so it behaves exactly like an unbound code: no cross-session information leak.
 */

import type { StuffyState } from "./state-machine";

export const TAG_CODE_MAX = 200;

/** Control characters (C0 and DEL) are rejected; the code is otherwise opaque. */
const CONTROL = /[\u0000-\u001f\u007f]/;

export type NormalizedTag = { ok: true; code: string } | { ok: false; error: string };

/**
 * Trim, 1 to 200 characters, no control characters. Stored EXACTLY as scanned: a
 * sticker that encodes a URL is stored verbatim and never navigated to or rendered as a link.
 */
export function normalizeTagCode(input: unknown): NormalizedTag {
  if (typeof input !== "string") return { ok: false, error: "A sticker code is required" };
  const code = input.trim();
  if (code.length === 0) return { ok: false, error: "A sticker code is required" };
  if (code.length > TAG_CODE_MAX) return { ok: false, error: `A sticker code is at most ${TAG_CODE_MAX} characters` };
  if (CONTROL.test(code)) return { ok: false, error: "That sticker code has characters that cannot be used" };
  return { ok: true, code };
}

/** The card shows only the tail of a sticker (identical-text stickers are told apart by it). */
export function last4(code: string | null | undefined): string | null {
  return code ? code.slice(-4) : null;
}

export interface TagTarget {
  id: string;
  state: StuffyState;
  tagCode: string | null;
}

export interface TagHolder {
  id: string;
  /** Display name, already resolved ("Unnamed stuffy, order of 3" when blank). */
  displayName: string;
  state: StuffyState;
  withdrawn: boolean;
}

export type TagDecision =
  | { kind: "noop" }
  | { kind: "bind" }
  | { kind: "replace"; prevTagCode: string }
  | { kind: "confirm_replace"; oldLast4: string }
  | { kind: "move"; holderId: string; prevTagCode: string | null }
  | { kind: "confirm_move"; otherStuffyName: string }
  | { kind: "holder_advanced"; otherStuffyName: string }
  | { kind: "illegal" };

export function decideTagBind(input: {
  target: TagTarget;
  holder: TagHolder | null;
  code: string;
  confirm?: "move" | "replace";
}): TagDecision {
  const { target, holder, code, confirm } = input;

  if (holder && holder.id === target.id) return { kind: "noop" };
  if (target.state !== "registered" && target.state !== "tagged") return { kind: "illegal" };

  if (holder) {
    const advanced = holder.state !== "registered" && holder.state !== "tagged" && !holder.withdrawn;
    if (advanced) return { kind: "holder_advanced", otherStuffyName: holder.displayName };
    if (confirm === "move") return { kind: "move", holderId: holder.id, prevTagCode: target.tagCode };
    return { kind: "confirm_move", otherStuffyName: holder.displayName };
  }

  if (target.tagCode === null) return { kind: "bind" };
  if (target.tagCode === code) return { kind: "noop" };
  if (confirm === "replace") return { kind: "replace", prevTagCode: target.tagCode };
  return { kind: "confirm_replace", oldLast4: last4(target.tagCode) ?? "" };
}
