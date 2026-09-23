/**
 * Pure, DB-independent helpers backing `AcknowledgeDialog`
 * (src/components/admin/ledger/acknowledge-dialog.tsx) and every other
 * surface that decides whether to offer an "Acknowledge" action
 * (docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md, Part 2:
 * "Acknowledge at any amount").
 *
 * `AcknowledgeDialog` renders inside a Radix `Dialog.Portal`, which no-ops
 * under this project's `environment: "node"` Vitest config (no
 * document/jsdom — see CLAUDE.md and ack-queue-ui.ts's own doc comment for
 * the established pattern) — `renderToStaticMarkup` of the dialog therefore
 * always comes back empty, portal content included. The amount-threshold
 * decision is extracted here so it stays unit-testable without a DOM,
 * exactly the same reasoning ack-queue-ui.ts documents for its own split.
 *
 * IMPORTANT — this module answers a UI-AFFORDANCE question ("should the
 * dialog pre-select the written-ack override, should it show the courtesy
 * note"), NOT the IRS-RULE question ("what type of acknowledgment does this
 * gift legally require"). That second question is `deriveAckType()`
 * (src/lib/ledger.ts) — untouched by this feature, and it must STAY a
 * separate function even though both currently key off the same $250
 * figure. Do not "deduplicate" the two into one: `deriveAckType()` encodes
 * Pub. 1771 itself (what the server enforces), while this module encodes
 * only what the dialog shows a treasurer before they submit. They are
 * allowed to agree on the number without being the same function — if IRS
 * guidance ever changed the substantiation threshold independent of some
 * future UI convenience default (unlikely, but not impossible), collapsing
 * them would make that change impossible to express.
 *
 * Also note: as of Part 2, NO Acknowledge-button visibility check anywhere
 * in the app gates on amount at all — the button is offered at any amount
 * whenever no acknowledgment exists yet (`ackStatus === null`), full stop.
 * This module's threshold only affects what happens once the dialog is
 * already open. Do not reintroduce an inline `amountCents >= 25000` (or
 * `< 25000`) check anywhere outside this file to gate button visibility —
 * see acknowledge-threshold-consolidation.test.ts, which fails the build if
 * one reappears in a UI file.
 */

/** IRS Pub. 1771's written-acknowledgment threshold, in cents. */
export const ACK_REQUIRED_THRESHOLD_CENTS = 25000;

/**
 * True when a gift is below the $250 figure at which IRS Pub. 1771 requires
 * a written acknowledgment. Below this threshold `deriveAckType()`
 * (src/lib/ledger.ts, untouched by this feature — see the module-level
 * IMPORTANT note above) returns null absent a qualifying quid-pro-quo
 * value, and the acknowledge route 422s unless a `typeOverride` is
 * supplied — see the two functions below, which exist so the dialog can
 * pre-empt that 422 and explain the distinction to the treasurer. This is
 * the ONLY place in the UI layer that should ever compare an amount to
 * this figure; every call site asks this function rather than restating
 * the comparison inline.
 */
export function isUnderAckThreshold(amountCents: number): boolean {
  return amountCents < ACK_REQUIRED_THRESHOLD_CENTS;
}

/**
 * The type-override `<select>`'s initial value. Pre-selects
 * "written_ack_250" for a sub-$250 gift so submitting the dialog's happy
 * path never 422s — the dropdown stays fully editable afterward, so a
 * treasurer entering a genuine quid-pro-quo value on a sub-$250 gift can
 * still switch it to "quid_pro_quo_75" manually. At or above $250,
 * "" (auto-detect from amount) is left alone — deriveAckType() already
 * handles that case correctly with no override needed.
 */
export function defaultTypeOverride(
  amountCents: number,
): "" | "written_ack_250" {
  return isUnderAckThreshold(amountCents) ? "written_ack_250" : "";
}

/**
 * Whether the dialog should show the courtesy-vs-required inline note —
 * exactly the sub-$250 case, alongside the pre-selected override above.
 */
export function showCourtesyNote(amountCents: number): boolean {
  return isUnderAckThreshold(amountCents);
}
