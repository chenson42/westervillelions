import type { CrewRosterRow, CrewSessionSummary } from "@/lib/santas-workshop/crew-contract";
import type { CrewCall } from "./crew-api";
import type { CrewAction } from "./crew-messages";
import type { Outbox, OutboxSnapshot } from "./outbox-core";

/** Where the app is. Mirrored to history.pushState so the phone's back button works. */
export type CrewView =
  | { name: "list"; pendingTag?: string }
  | { name: "scan" }
  | { name: "stuffy"; id: string; row: CrewRosterRow; pendingTag?: string }
  | { name: "group" };

export interface CrewCtx {
  slug: string;
  session: CrewSessionSummary;
  /** True when this phone is signed in as a club admin rather than with the worker code. */
  adminBypass: boolean;
  rows: CrewRosterRow[];
  outbox: Outbox;
  outboxSnap: OutboxSnapshot;
  /** The outbox is backed by IndexedDB (survives closing the page). */
  durable: boolean;
  navigate(view: CrewView): void;
  back(): void;
  /** Replace one row with the server's fresh copy of it. */
  applyRow(row: CrewRosterRow): void;
  refresh(): Promise<void>;
  /**
   * Turns a failed call into the sentence to show. A 401 also sends the whole app
   * back to the code screen (the outbox is held, nothing is lost).
   */
  failureText(call: Extract<CrewCall<unknown>, { ok: false }>, action: CrewAction): string;
}
