/**
 * Category mirrors (B-172, DECISION-126). Client-safe carrier: zero runtime
 * `@/lib/db` imports. The category routes, the category screen and the
 * transaction form all import their types, codes and copy from here, so a
 * removed or widened member breaks `tsc` at every consumer.
 *
 * A Club Public Funds (activity) INCOME category may declare the Foundation
 * charitable INCOME category its gifts become when swept
 * (`ledger_categories.mirrors_category_id`). The Foundation category is the
 * only source of `counts_as_giving` and `ack_not_required` for a copy, so the
 * Public Funds category's two flags are read-only while a counterpart is set.
 * `form_990_line` stays Club-owned and editable.
 */
import { ACK_MIN_CENTS } from "@/lib/ledger";
import { DEFAULT_FUND_LABELS, type FundLabels } from "@/lib/ledger-fund-labels";

/** The fields of a category the mirror rules read. */
export interface MirrorCategoryFacts {
  id: string;
  fundKind: string;
  flow: string;
  /** `ledger_entities.donations_deductible` of the category's entity (Foundation true, Club false). */
  entityDonationsDeductible: boolean;
}

export interface MirrorTargetFacts extends MirrorCategoryFacts {
  isActive: boolean;
}

/** Codes from checkCategoryMirror(); each is a 400 on the category routes. */
export type MirrorCheckCode =
  | "subject_not_public_income"
  | "target_not_foundation_income"
  | "target_inactive"
  | "target_is_self";

/** Every error code the mirror surface can answer with (validation, lookup, guard, merge). */
export type MirrorErrorCode =
  | MirrorCheckCode
  | "invalid_mirror"
  | "mirror_target_not_found"
  | "mirrored_flag_read_only"
  | "mirror_conflict";

export type MirrorCheckResult = { ok: true } | { ok: false; code: MirrorCheckCode };

/** True for the one kind of category that may declare a counterpart: Club Public Funds income. */
export function isPublicFundsIncome(c: Pick<MirrorCategoryFacts, "fundKind" | "flow" | "entityDonationsDeductible">): boolean {
  return c.fundKind === "activity" && c.flow === "income" && !c.entityDonationsDeductible;
}

/**
 * Is `target` a valid counterpart for `subject`? A null target (clear) is
 * always valid. Order: self, subject shape, target shape, target active.
 */
export function checkCategoryMirror(
  subject: MirrorCategoryFacts,
  target: MirrorTargetFacts | null,
): MirrorCheckResult {
  if (target === null) return { ok: true };
  if (target.id === subject.id) return { ok: false, code: "target_is_self" };
  if (!isPublicFundsIncome(subject)) return { ok: false, code: "subject_not_public_income" };
  if (!(target.entityDonationsDeductible && target.fundKind === "charitable" && target.flow === "income")) {
    return { ok: false, code: "target_not_foundation_income" };
  }
  if (!target.isActive) return { ok: false, code: "target_inactive" };
  return { ok: true };
}

/**
 * Does a PATCH change a flag that a counterpart owns? With the EFFECTIVE
 * mirror (the patch's value if present, else the stored one) non-null, a
 * patch that CHANGES `countsAsGiving` or `ackNotRequired` is refused. A patch
 * that repeats the stored value is a no-op, and one that clears the mirror in
 * the same request may change flags.
 */
export function mirroredFlagEditBlocked(input: {
  storedMirrorId: string | null;
  /** `undefined` when the patch does not mention the mirror. */
  patchMirrorId: string | null | undefined;
  stored: { countsAsGiving: boolean; ackNotRequired: boolean };
  patch: { countsAsGiving?: boolean; ackNotRequired?: boolean };
}): boolean {
  const effective = input.patchMirrorId === undefined ? input.storedMirrorId : input.patchMirrorId;
  if (effective === null) return false;
  const countsChanges =
    input.patch.countsAsGiving !== undefined && input.patch.countsAsGiving !== input.stored.countsAsGiving;
  const ackChanges =
    input.patch.ackNotRequired !== undefined && input.patch.ackNotRequired !== input.stored.ackNotRequired;
  return countsChanges || ackChanges;
}

// ---------------------------------------------------------------------------
// Read-only projection of the counterpart onto the Public Funds category
// ---------------------------------------------------------------------------

/** What the category screen shows for a mirrored category; the Foundation category is the source. */
export interface MirrorProjection {
  id: string;
  name: string;
  isActive: boolean;
  countsAsGiving: boolean;
  ackNotRequired: boolean;
  /** The Foundation's own Form 990 line, informational only (null: "No Form 990 line"). */
  form990Line: string | null;
}

// ---------------------------------------------------------------------------
// The "Foundation-bound" hint on the transaction form
// ---------------------------------------------------------------------------

export type MirrorHint =
  | { state: "not_applicable" }
  | { state: "stays"; reason: "no_mirror" | "mirror_inactive" }
  | {
      state: "bound";
      foundationCategoryName: string;
      /** `not_needed` when the counterpart is ack-exempt or the amount is under the written-acknowledgment threshold. */
      receipt: "may_be_needed" | "not_needed";
    };

/**
 * Hint for a gift keyed into `category`. `mirror` is the counterpart's
 * projection (null: none). `amountCents` is optional: with an amount under
 * ACK_MIN_CENTS no written receipt is required.
 */
export function describeMirrorHint(
  category: Pick<MirrorCategoryFacts, "fundKind" | "flow" | "entityDonationsDeductible"> | null,
  mirror: Pick<MirrorProjection, "name" | "isActive" | "ackNotRequired"> | null,
  amountCents?: number | null,
): MirrorHint {
  if (!category || !isPublicFundsIncome(category)) return { state: "not_applicable" };
  if (!mirror) return { state: "stays", reason: "no_mirror" };
  if (!mirror.isActive) return { state: "stays", reason: "mirror_inactive" };
  const underThreshold = typeof amountCents === "number" && amountCents < ACK_MIN_CENTS;
  return {
    state: "bound",
    foundationCategoryName: mirror.name,
    receipt: mirror.ackNotRequired || underThreshold ? "not_needed" : "may_be_needed",
  };
}

// ---------------------------------------------------------------------------
// Copy (one place; exhaustive records, so a new code or state is a compile error)
// ---------------------------------------------------------------------------

export const MIRROR_COPY: Record<MirrorErrorCode, (labels: FundLabels) => string> = {
  subject_not_public_income: (l) =>
    `Only a ${l.activity} income category can have a Foundation counterpart.`,
  target_not_foundation_income: () =>
    "The counterpart must be an income category in the Foundation's Charitable fund.",
  target_inactive: () => "That Foundation category is deactivated. Reactivate it or choose another.",
  target_is_self: () => "A category cannot be its own counterpart.",
  invalid_mirror: () => "mirrorsCategoryId must be a category id or null.",
  mirror_target_not_found: () => "The chosen Foundation category was not found.",
  mirrored_flag_read_only: (l) =>
    `While a Foundation counterpart is set, "counts as giving" and "receipt not required" are read from the Foundation category. Clear the counterpart first to change them here, or change them on the Foundation category. (${l.activity} reports its own Form 990 line.)`,
  mirror_conflict: () =>
    "Both categories already have a Foundation counterpart, and they differ. Set the same counterpart on both, or clear one, then merge.",
};

export function mirrorErrorMessage(code: MirrorErrorCode, labels: FundLabels = DEFAULT_FUND_LABELS): string {
  return MIRROR_COPY[code](labels);
}

/** Until itemized sweeps ship (B-172 Increment 2a) the sweep is one lump amount. */
const LUMP_SWEEP_NOTE =
  "Sweeps are still recorded as one lump amount for now, so the Foundation will not show this gift or its donor yet.";

/** Hint copy, an exhaustive switch over every state. */
export function mirrorHintCopy(hint: MirrorHint, labels: FundLabels = DEFAULT_FUND_LABELS): string | null {
  switch (hint.state) {
    case "not_applicable":
      return null;
    case "stays":
      return hint.reason === "no_mirror"
        ? `This category has no Foundation counterpart, so it is recorded as staying in ${labels.activity}. Today's lump sweep does not check this.`
        : `The Foundation counterpart of this category is deactivated, so it is recorded as staying in ${labels.activity} until it is re-pointed. Today's lump sweep does not check this.`;
    case "bound":
      return hint.receipt === "may_be_needed"
        ? `Foundation-bound: this gift belongs with the Foundation's "${hint.foundationCategoryName}" category, and a written receipt will be needed. ${LUMP_SWEEP_NOTE}`
        : `Foundation-bound: this gift belongs with the Foundation's "${hint.foundationCategoryName}" category. No written acknowledgment is required for this one (you can still send one from the Foundation). ${LUMP_SWEEP_NOTE}`;
    default: {
      const unreachable: never = hint;
      return unreachable;
    }
  }
}
