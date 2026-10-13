/**
 * Stuffy state machine (pure, client-safe). Illegal moves (`tagged` to
 * `picked_up`, skipping states) are refused by this table, not by a screen.
 *
 *   registered -> tagged -> checked_in -> portrait_taken -> picked_up
 *                                   \------------------------^   (pickup is allowed with no portrait)
 *
 * A retake is not a transition: portrait_taken stays portrait_taken (a new
 * current photo supersedes the old one; stuffy-transitions.ts).
 */

export const STUFFY_STATES = ["registered", "tagged", "checked_in", "portrait_taken", "picked_up"] as const;

export type StuffyState = (typeof STUFFY_STATES)[number];

export function isStuffyState(value: string): value is StuffyState {
  return (STUFFY_STATES as readonly string[]).includes(value);
}

const FORWARD: Record<StuffyState, readonly StuffyState[]> = {
  registered: ["tagged"],
  tagged: ["checked_in"],
  checked_in: ["portrait_taken", "picked_up"],
  portrait_taken: ["picked_up"],
  picked_up: [],
};

export function canTransition(from: StuffyState, to: StuffyState): boolean {
  return FORWARD[from].includes(to);
}

/** Pickup is allowed from checked_in (no portrait) and portrait_taken only. */
export function isPickupAllowedFrom(state: StuffyState): boolean {
  return state === "checked_in" || state === "portrait_taken";
}

export function stateIndex(state: StuffyState): number {
  return STUFFY_STATES.indexOf(state);
}

/** True when `to` lies strictly before `from` (a backward move). */
export function isBackward(from: StuffyState, to: StuffyState): boolean {
  return stateIndex(to) < stateIndex(from);
}

export type RevertActor = "crew" | "admin";

/**
 * Whether the actor may move a stuffy backward. An admin always may (with a
 * reason, enforced by the route); a crew device only on a PRACTICE session so the
 * dry run can repeat flows while a real session never gives a volunteer a backward move.
 */
export function canRevert(actor: RevertActor, sessionKind: "practice" | "real"): boolean {
  return actor === "admin" || sessionKind === "practice";
}
