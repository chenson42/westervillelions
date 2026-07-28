/**
 * Pure UI-only helpers for the member-visible Monthly Statement of Financial
 * Condition (2026-07-28-monthly-financial-report, Phase 4 UI half).
 *
 * No `@/lib/db` import, no async — kept separate from
 * `src/lib/financial-report-queries.ts` (the query layer, owned by
 * api-developer and marked complete) since this file exists purely to
 * compose a picker's option list out of a single boundary month, with zero
 * new DB queries. See docs/work-log/2026-07-28-monthly-financial-report.md
 * Phase 4 (UI) for the full rationale.
 */

export type MonthOption = {
  /** 'YYYY-MM' — matches the [month] route segment and MonthlyStatement.month. */
  value: string;
  /** "June 2026" — display label. */
  label: string;
};

/**
 * How many trailing months the landing page and the statement detail page's
 * picker offer, counting back from an entity's latest gated-open month.
 * `getMonthlyStatement()`'s gate is monotonic (DECISION-049/050 §
 * isMonthGatedForEntity: if no unreconciled posted transaction exists on or
 * before month-end X, none exists on or before any earlier month-end either),
 * so every month at or before `latestOpenMonth` is guaranteed ready — this
 * constant only bounds how far back the picker scrolls, not correctness.
 * 24 covers two full fiscal years, comfortably past this club's entire
 * digitized history (the 2026-07-20 Quicken import seeded roughly one FY).
 */
export const RECENT_MONTHS_WINDOW = 24;

/**
 * Pure. Builds up to `count` month options ending at (and including)
 * `latestOpenMonth`, most-recent-first, for a `<select>` picker. No DB
 * access — this is why it lives outside financial-report-queries.ts: a UI
 * convenience that composes a single already-fetched boundary month, not a
 * new correctness-bearing query.
 *
 * Uses `new Date(y, m - 1, 1)` purely to format a display label (day fixed
 * at 1, never used for calendar-boundary arithmetic) — avoids the
 * naive-timestamp-as-UTC class of bug this codebase has hit before, since
 * there is no UTC round-trip here: the y/m integers come from a plain
 * 'YYYY-MM' string, not a DB timestamp column.
 */
export function buildRecentMonthOptions(
  latestOpenMonth: string,
  count: number = RECENT_MONTHS_WINDOW,
): MonthOption[] {
  const [startYStr, startMStr] = latestOpenMonth.split("-");
  let y = Number(startYStr);
  let m = Number(startMStr);

  const options: MonthOption[] = [];
  for (let i = 0; i < count; i++) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
    options.push({ value, label });

    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return options;
}

/**
 * Ensures `month` appears in `options`, prepending a synthetic entry when
 * it's missing (e.g. a direct-URL hit on a future or otherwise-ungated month
 * that fell outside the generated window). Used by the statement detail page
 * so its picker's selected value always reflects the URL actually being
 * viewed, even in the 'gated' or not-yet-published edge cases — never a
 * silently-wrong selection. Pure; does not mutate `options`.
 */
export function ensureMonthOption(options: MonthOption[], month: string): MonthOption[] {
  if (options.some((o) => o.value === month)) return options;
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const label =
    !Number.isNaN(y) && !Number.isNaN(m)
      ? new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : month;
  return [{ value: month, label }, ...options];
}
