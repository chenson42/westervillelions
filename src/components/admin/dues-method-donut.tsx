import type { DuesMethodComposition, DuesMethodSlice } from "@/lib/dues";

interface DuesMethodDonutProps {
  composition: DuesMethodComposition;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDollarsCompact(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 100_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Categorical color assignment, fixed order — see dataviz skill color-formula.md.
 * Slots 1–4 (blue/aqua/yellow/green) of the validated 8-hue palette go to the
 * four payment methods in the order the treasurer asked for them (Check, Zeffy,
 * Cash, Other). "Unpaid" is intentionally NOT a categorical hue — it's muted
 * gray so it reads as absence rather than competing with the method slices.
 * Validated: `node scripts/validate_palette.js "#2a78d6,#1baf7a,#eda100,#008300" --mode light`
 * — all 4 checks pass (CVD worst-adjacent ΔE 24.2; light-mode contrast WARN on
 * aqua/yellow is mitigated by the always-visible legend + sr-only table below).
 */
const SLICE_COLORS: Record<DuesMethodSlice["key"], string> = {
  check: "#2a78d6", // categorical slot 1 — blue
  zeffy: "#1baf7a", // categorical slot 2 — aqua
  cash: "#eda100", // categorical slot 3 — yellow
  other: "#008300", // categorical slot 4 — green
  unpaid: "#c3c2b7", // muted gray — absence, not identity
};

const CX = 120;
const CY = 120;
const OUTER_R = 100;
const INNER_R = 64;
const GAP_DEGREES = 2.5; // surface gap between slices (marks-and-anatomy.md)

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Builds an SVG path for one annular (donut) wedge between startDeg and endDeg. */
function donutWedgePath(startDeg: number, endDeg: number): string {
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  const outerStart = polarToCartesian(CX, CY, OUTER_R, startDeg);
  const outerEnd = polarToCartesian(CX, CY, OUTER_R, endDeg);
  const innerStart = polarToCartesian(CX, CY, INNER_R, startDeg);
  const innerEnd = polarToCartesian(CX, CY, INNER_R, endDeg);

  return [
    `M ${innerStart.x} ${innerStart.y}`,
    `L ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

/**
 * Payment-composition donut for /admin/dues. Server Component — this project
 * has no chart library and none should be added (CLAUDE.md); the donut is
 * plain inline SVG. Static/non-interactive by design (the page itself is a
 * Server Component and this chart has no client-side state), so it
 * deliberately skips the dataviz skill's default hover/tooltip layer — the
 * legend below carries every value a tooltip would.
 */
export default function DuesMethodDonut({
  composition,
  paidCount,
  partialCount,
  unpaidCount,
}: DuesMethodDonutProps) {
  const { slices, totalCollectedCents, totalExpectedCents } = composition;

  if (slices.length === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        {totalExpectedCents <= 0
          ? "Dues amounts aren't configured for this year yet, so there's no expected total to chart."
          : "No dues payments recorded for this year yet."}
      </div>
    );
  }

  // Slice angles, in fixed order, each shrunk by half the gap on either side.
  const totalPct = slices.reduce((sum, s) => sum + s.pct, 0) || 1;
  let cursorDeg = 0;
  const wedges = slices.map((slice) => {
    const sweepDeg = (slice.pct / totalPct) * 360;
    const startDeg = cursorDeg;
    const endDeg = cursorDeg + sweepDeg;
    cursorDeg = endDeg;
    const halfGap = slices.length > 1 ? GAP_DEGREES / 2 : 0;
    const trimmedStart = Math.min(startDeg + halfGap, endDeg);
    const trimmedEnd = Math.max(endDeg - halfGap, startDeg);
    return {
      slice,
      path:
        trimmedEnd > trimmedStart
          ? donutWedgePath(trimmedStart, trimmedEnd)
          : donutWedgePath(startDeg, endDeg),
    };
  });

  const ariaLabel = `Payment composition donut chart. ${slices
    .map((s) => `${s.label}: ${formatDollars(s.cents)}, ${s.pct.toFixed(1)} percent`)
    .join(". ")}. Total collected: ${formatDollars(totalCollectedCents)}.`;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-6">
      <h2 className="text-lg font-semibold text-gray-900">Payment Composition</h2>
      <p className="text-sm text-gray-500 mt-0.5">By method, {fiscalYearNote(totalExpectedCents)}</p>

      <div className="mt-4 flex flex-col md:flex-row items-center gap-8">
        <div className="relative shrink-0 w-56 h-56">
          <svg
            viewBox="0 0 240 240"
            role="img"
            aria-label={ariaLabel}
            className="w-full h-full"
          >
            {wedges.map(({ slice, path }) => (
              <path key={slice.key} d={path} fill={SLICE_COLORS[slice.key]} />
            ))}
          </svg>
          {/* Center figure — total collected must stay prominently visible. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              Total Collected
            </span>
            <span className="text-2xl font-bold text-gray-900 leading-tight">
              {formatDollarsCompact(totalCollectedCents)}
            </span>
          </div>
        </div>

        <div className="flex-1 w-full">
          <p className="text-sm font-medium text-gray-900 mb-2">
            {formatDollars(totalCollectedCents)} collected
            {totalExpectedCents > 0 && <> of {formatDollars(totalExpectedCents)} expected</>}
          </p>
          <ul className="space-y-1.5">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-gray-700">
                  <span
                    className="h-3 w-3 rounded-sm shrink-0"
                    style={{ backgroundColor: SLICE_COLORS[slice.key] }}
                    aria-hidden="true"
                  />
                  {slice.label}
                </span>
                <span className="tabular-nums text-gray-700">
                  {formatDollars(slice.cents)}{" "}
                  <span className="text-gray-400">({slice.pct.toFixed(1)}%)</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
            {paidCount} paid &middot; {partialCount} partial &middot; {unpaidCount} unpaid
          </p>
        </div>
      </div>

      {/* Screen-reader-only data table equivalent — color never carries meaning alone. */}
      <table className="sr-only">
        <caption>Dues payment composition by method</caption>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Amount</th>
            <th scope="col">Percent</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.key}>
              <th scope="row">{slice.label}</th>
              <td>{formatDollars(slice.cents)}</td>
              <td>{slice.pct.toFixed(1)}%</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total collected</th>
            <td>{formatDollars(totalCollectedCents)}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function fiscalYearNote(totalExpectedCents: number): string {
  return totalExpectedCents > 0 ? "versus the fiscal year's expected total" : "collected so far";
}
