export interface VersionPickerOption {
  id: string;
  label: string;
}

/**
 * Plain `<form method="get">` two-`<select>` version picker for the compare
 * views — no client-side diff engine, no JS required for the picker itself
 * (Phase 3 "Diffing"). A pure Server Component; submitting re-renders the
 * compare page server-side with new `?from=&to=` query params.
 */
export function VersionPickerForm({
  action,
  options,
  from,
  to,
}: {
  action: string;
  options: VersionPickerOption[];
  from: string;
  to: string;
}) {
  return (
    <form
      method="get"
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-2xl bg-white shadow-sm p-4"
    >
      <div className="flex-1 min-w-[10rem]">
        <label htmlFor="compare-from" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
          Compare from
        </label>
        <select
          id="compare-from"
          name="from"
          defaultValue={from}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[10rem]">
        <label htmlFor="compare-to" className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
          Compare to
        </label>
        <select
          id="compare-to"
          name="to"
          defaultValue={to}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue min-h-[44px]"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        Compare
      </button>
    </form>
  );
}
