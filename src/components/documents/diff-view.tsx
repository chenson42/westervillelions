import type { Change } from "diff";
import { buildDiffBlocks, countChangeRegions, type DiffBlock, type DiffLineRow } from "./diff-blocks";

// How many lines of context to show immediately adjacent to a change before
// collapsing the rest — keeps a reader oriented without opening anything,
// while still hiding the bulk of a long unchanged run (the 642-line
// document this feature was built for makes this a real, not theoretical,
// concern — Phase 3 "Diffing" / Ruling 4).
const CONTEXT_EDGE = 3;
// Only worth collapsing if there's a real middle to hide.
const CONTEXT_COLLAPSE_THRESHOLD = CONTEXT_EDGE * 2 + 4;

function lineRowClass(type: DiffLineRow["type"]): string {
  if (type === "added") return "bg-green-50 text-green-900";
  if (type === "removed") return "bg-red-50 text-red-800";
  return "text-gray-700";
}

function linePrefix(type: DiffLineRow["type"]): string {
  if (type === "added") return "+";
  if (type === "removed") return "-";
  return " ";
}

function DiffLineRowView({ line }: { line: DiffLineRow }) {
  return (
    <div
      className={`flex gap-2 px-3 py-0.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words ${lineRowClass(line.type)}`}
    >
      <span aria-hidden="true" className="w-3 flex-shrink-0 select-none text-gray-400">
        {linePrefix(line.type)}
      </span>
      <span>{line.text.length === 0 ? " " : line.text}</span>
    </div>
  );
}

function ContextBlock({ lines }: { lines: DiffLineRow[] }) {
  if (lines.length <= CONTEXT_COLLAPSE_THRESHOLD) {
    return (
      <div>
        {lines.map((line, i) => (
          <DiffLineRowView key={i} line={line} />
        ))}
      </div>
    );
  }

  const head = lines.slice(0, CONTEXT_EDGE);
  const middle = lines.slice(CONTEXT_EDGE, lines.length - CONTEXT_EDGE);
  const tail = lines.slice(lines.length - CONTEXT_EDGE);

  return (
    <div>
      {head.map((line, i) => (
        <DiffLineRowView key={`h${i}`} line={line} />
      ))}
      <details className="my-0.5">
        <summary className="cursor-pointer select-none rounded bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lions-blue">
          Show {middle.length} unchanged {middle.length === 1 ? "line" : "lines"}
        </summary>
        <div>
          {middle.map((line, i) => (
            <DiffLineRowView key={`m${i}`} line={line} />
          ))}
        </div>
      </details>
      {tail.map((line, i) => (
        <DiffLineRowView key={`t${i}`} line={line} />
      ))}
    </div>
  );
}

/**
 * Renders an already-computed `Change[]` (jsdiff's own shape, from
 * `diffDocumentVersions()` in `src/lib/documents.ts`) as a genuinely
 * readable unified diff — never a wall of coloured lines. A pure, props-only
 * Server Component: it never imports `diff` itself, only the `Change` TYPE
 * (erased at build time) — the diff is always computed server-side by the
 * caller (DECISION-076 Ruling 2/4) and handed down as plain data.
 *
 * Readability strategy (Phase 4 requirement 2 — "think about how someone
 * actually reads it"):
 *   - Long unchanged runs collapse behind a native `<details>` disclosure
 *     (no client JS needed), keeping a few lines of context visible on
 *     either side so a reader stays oriented.
 *   - Every changed region gets a stable `#diff-change-N` anchor and a
 *     "Jump to N" link in the summary bar, so a reader (or the board,
 *     during a meeting) can navigate straight to what changed instead of
 *     scrolling a 600+ line document.
 *   - Zero changes is its own explicit state ("No differences"), not a
 *     blank render.
 */
export function DiffView({ diff }: { diff: Change[] }) {
  const blocks = buildDiffBlocks(diff);
  const changeCount = countChangeRegions(blocks);

  if (changeCount === 0) {
    return (
      <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
        <p>No differences between these two versions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" id="diff-top">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-lions-blue/5 px-4 py-3 text-sm">
        <span className="font-semibold text-gray-900">
          {changeCount} changed {changeCount === 1 ? "section" : "sections"}
        </span>
        <span className="flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-100" aria-hidden="true" /> removed
          <span className="inline-block h-3 w-3 rounded-sm bg-green-50 border border-green-200" aria-hidden="true" />{" "}
          added
        </span>
        {changeCount > 1 && (
          <span className="flex flex-wrap gap-1">
            {Array.from({ length: changeCount }, (_, i) => i + 1).map((n) => (
              <a
                key={n}
                href={`#diff-change-${n}`}
                className="rounded border border-lions-blue/30 bg-white px-2 py-0.5 text-xs font-semibold text-lions-blue hover:bg-lions-blue/10 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                Jump to {n}
              </a>
            ))}
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
        <div className="min-w-[32rem]">
          {blocks.map((block: DiffBlock, i) =>
            block.kind === "context" ? (
              <ContextBlock key={i} lines={block.lines} />
            ) : (
              <div
                key={i}
                id={`diff-change-${block.regionNumber}`}
                className="scroll-mt-24 border-y-2 border-lions-blue/20"
              >
                {block.lines.map((line, j) => (
                  <DiffLineRowView key={j} line={line} />
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
