import { WORKSHOP_2026, type WorkshopFacts } from "./facts";

/**
 * The facts the public page renders. Async from day one so a later source (for
 * example a session row) swaps in here with no page change. Today it returns
 * the typed constant; it deliberately does not validate at runtime (CI does).
 */
export async function getPublicWorkshopFacts(): Promise<WorkshopFacts> {
  return WORKSHOP_2026;
}
