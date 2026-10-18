/**
 * Fund display names (DECISION-127). Client-safe and pure: no database import.
 *
 * The stored `ledger_funds.name` is the one source of a fund's display name.
 * The Club's public fund is stored as "Activity Fund" until the treasurer
 * renames it in the fund editor; this module never hard-codes that string.
 * `DEFAULT_FUND_LABELS` is the fallback for a kind with no active fund row (a
 * fresh install, a test), and the server reads the rows through
 * `ledger-fund-labels-queries.ts`.
 *
 * `kind` is stable ("activity" never changes); only the name is editable. A
 * pure policy function that needs a name receives it on its fund descriptor
 * (`FundRef.name`) or as a `FundLabels` argument, never from the database.
 */

export type FundKind = "administrative" | "activity" | "charitable" | "scholarship";

/** Fund kind to display name. */
export type FundLabels = Record<FundKind, string>;

export const DEFAULT_FUND_LABELS: FundLabels = {
  administrative: "Administrative Fund",
  activity: "Public Funds",
  charitable: "Charitable Fund",
  scholarship: "Scholarship Fund",
};

const KINDS = Object.keys(DEFAULT_FUND_LABELS) as FundKind[];

function isFundKind(kind: string): kind is FundKind {
  return (KINDS as string[]).includes(kind);
}

export interface FundLabelRow {
  kind: string;
  name: string;
  isActive?: boolean;
}

/**
 * Build labels from fund rows. The first ACTIVE row of a kind wins; an
 * inactive row is used only when no active row of that kind exists; a kind
 * with no row keeps its default. Blank names are ignored.
 */
export function buildFundLabels(rows: readonly FundLabelRow[]): FundLabels {
  const labels: FundLabels = { ...DEFAULT_FUND_LABELS };
  const decidedActive = new Set<FundKind>();
  const decidedInactive = new Set<FundKind>();
  for (const row of rows) {
    if (!isFundKind(row.kind)) continue;
    const name = row.name.trim();
    if (!name) continue;
    if (row.isActive !== false) {
      if (decidedActive.has(row.kind)) continue;
      labels[row.kind] = name;
      decidedActive.add(row.kind);
    } else if (!decidedActive.has(row.kind) && !decidedInactive.has(row.kind)) {
      labels[row.kind] = name;
      decidedInactive.add(row.kind);
    }
  }
  return labels;
}

/** Name for a fund descriptor: its own stored name when given, else the default for its kind. */
export function refName(ref: { kind: string; name?: string | null }): string {
  const own = ref.name?.trim();
  return own ? own : fundLabel(ref.kind);
}

/** Display name for a fund kind; an unknown kind is returned as given. */
export function fundLabel(kind: string, labels: FundLabels = DEFAULT_FUND_LABELS): string {
  return isFundKind(kind) ? labels[kind] : kind;
}

/**
 * A short noun for the KIND ("Public" for activity). Never the stored name:
 * the kind does not change, so no lookup is needed.
 */
export function fundKindBadge(kind: string): string {
  switch (kind) {
    case "activity":
      return "Public";
    case "administrative":
      return "Administrative";
    case "charitable":
      return "Charitable";
    case "scholarship":
      return "Scholarship";
    default:
      return kind;
  }
}

/** Static explainer shown under a register heading; null when none applies. */
export function fundExplainer(kind: string, labels: FundLabels = DEFAULT_FUND_LABELS): string | null {
  return kind === "activity"
    ? `${labels.activity} is the Lions International Activities account: money raised from the public, held for charitable use.`
    : null;
}
