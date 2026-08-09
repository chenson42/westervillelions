"use client";

import { MOTION_RESULTS, type MotionResult } from "@/lib/minutes";

export interface MotionRow {
  text: string;
  moverName: string;
  seconderName: string;
  result: MotionResult;
}

interface MotionsEditorProps {
  value: MotionRow[];
  onChange: (value: MotionRow[]) => void;
  disabled?: boolean;
}

function emptyMotion(): MotionRow {
  return { text: "", moverName: "", seconderName: "", result: "passed" };
}

function resultLabel(result: string): string {
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/** Add/remove-row editor for motions (Phase 3 Flow 2: "text, mover,
 *  seconder, result"). Whole-array state, replaced wholesale on Save — no
 *  per-row autosave (mirrors the API's delete-then-reinsert `update`
 *  semantics). Mover/seconder are free text, not member FKs
 *  (DECISION-077 §2). */
export function MotionsEditor({ value, onChange, disabled = false }: MotionsEditorProps) {
  function update(index: number, patch: Partial<MotionRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...value, emptyMotion()]);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">Motions</p>
      {value.length === 0 && (
        <p className="text-sm text-gray-400">No motions recorded yet.</p>
      )}
      {value.map((row, index) => (
        <div key={index} className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`motion-text-${index}`}>
              Motion text
            </label>
            <textarea
              id={`motion-text-${index}`}
              value={row.text}
              onChange={(e) => update(index, { text: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="Motion to approve the FY2027 budget as presented"
              className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label="Remove this motion"
                title="Remove this motion"
                className="flex-shrink-0 rounded-lg p-2 min-h-[44px] min-w-[44px] text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                ✕
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor={`motion-mover-${index}`} className="block text-xs text-gray-500 mb-1">
                Moved by
              </label>
              <input
                id={`motion-mover-${index}`}
                type="text"
                value={row.moverName}
                onChange={(e) => update(index, { moverName: e.target.value })}
                disabled={disabled}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor={`motion-seconder-${index}`} className="block text-xs text-gray-500 mb-1">
                Seconded by (optional)
              </label>
              <input
                id={`motion-seconder-${index}`}
                type="text"
                value={row.seconderName}
                onChange={(e) => update(index, { seconderName: e.target.value })}
                disabled={disabled}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor={`motion-result-${index}`} className="block text-xs text-gray-500 mb-1">
                Result
              </label>
              <select
                id={`motion-result-${index}`}
                value={row.result}
                onChange={(e) => update(index, { result: e.target.value as MotionResult })}
                disabled={disabled}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
              >
                {MOTION_RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {resultLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={add}
          className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
        >
          + Add motion
        </button>
      )}
    </div>
  );
}
