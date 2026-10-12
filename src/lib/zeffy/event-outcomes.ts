/**
 * Vocabulary of the generic `zeffy_events` log. Client-safe (no imports): the
 * admin UI and the carrier module re-export it.
 */

export const ZEFFY_EVENT_OUTCOMES = [
  "received",
  "processed",
  "ignored_unmapped",
  "ignored_type",
  "invalid",
  "unsupported_version",
  "failed",
] as const;

export type ZeffyEventOutcome = (typeof ZEFFY_EVENT_OUTCOMES)[number];

/**
 * Outcomes after which a redelivery of the same event id is a no-op (DECISION-123
 * ruling 3). `received` (a crash mid-processing) and `failed` (a retryable error)
 * are NOT terminal: Zeffy's retry of those is the whole point of retrying.
 */
export const TERMINAL_ZEFFY_OUTCOMES: readonly ZeffyEventOutcome[] = [
  "processed",
  "ignored_unmapped",
  "ignored_type",
  "invalid",
  "unsupported_version",
];

export function isTerminalOutcome(outcome: string): boolean {
  return (TERMINAL_ZEFFY_OUTCOMES as readonly string[]).includes(outcome);
}
