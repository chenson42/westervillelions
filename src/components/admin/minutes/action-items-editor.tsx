"use client";

export interface ActionItemRow {
  text: string;
  ownerName: string;
  dueDate: string; // "" = no due date
}

interface ActionItemsEditorProps {
  value: ActionItemRow[];
  onChange: (value: ActionItemRow[]) => void;
  disabled?: boolean;
}

function emptyActionItem(): ActionItemRow {
  return { text: "", ownerName: "", dueDate: "" };
}

/** Add/remove-row editor for action items (Phase 3 Flow 2: "text, owner,
 *  due date"). Owner is free text, not a member FK (DECISION-077 §2). */
export function ActionItemsEditor({ value, onChange, disabled = false }: ActionItemsEditorProps) {
  function update(index: number, patch: Partial<ActionItemRow>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...value, emptyActionItem()]);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">Action items</p>
      {value.length === 0 && (
        <p className="text-sm text-gray-400">No action items recorded yet.</p>
      )}
      {value.map((row, index) => (
        <div key={index} className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`action-text-${index}`}>
              Action item text
            </label>
            <textarea
              id={`action-text-${index}`}
              value={row.text}
              onChange={(e) => update(index, { text: e.target.value })}
              disabled={disabled}
              rows={2}
              placeholder="Reserve the pavilion for the fall food drive"
              className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label="Remove this action item"
                title="Remove this action item"
                className="flex-shrink-0 rounded-lg p-2 min-h-[44px] min-w-[44px] text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                ✕
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor={`action-owner-${index}`} className="block text-xs text-gray-500 mb-1">
                Owner
              </label>
              <input
                id={`action-owner-${index}`}
                type="text"
                value={row.ownerName}
                onChange={(e) => update(index, { ownerName: e.target.value })}
                disabled={disabled}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
              />
            </div>
            <div>
              <label htmlFor={`action-due-${index}`} className="block text-xs text-gray-500 mb-1">
                Due date (optional)
              </label>
              <input
                id={`action-due-${index}`}
                type="date"
                value={row.dueDate}
                onChange={(e) => update(index, { dueDate: e.target.value })}
                disabled={disabled}
                className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
              />
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
          + Add action item
        </button>
      )}
    </div>
  );
}
