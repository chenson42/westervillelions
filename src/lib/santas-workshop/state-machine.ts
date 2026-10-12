/**
 * Stuffy state vocabulary (pure, client-safe). Slice 1 needs only the tuple
 * (counts by state on the session overview); the forward table, canTransition,
 * isPickupAllowedFrom and canRevert arrive with the worker screens in Slice 2.
 */

export const STUFFY_STATES = ["registered", "tagged", "checked_in", "portrait_taken", "picked_up"] as const;

export type StuffyState = (typeof STUFFY_STATES)[number];

export function isStuffyState(value: string): value is StuffyState {
  return (STUFFY_STATES as readonly string[]).includes(value);
}
