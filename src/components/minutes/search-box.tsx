interface SearchBoxProps {
  defaultValue?: string;
  /** Preserved as a hidden field so a kind filter stays applied when searching. */
  kind?: string;
}

/**
 * Search box for /members/records — a plain server-rendered `<form
 * method="get">`, no client fetch (Phase 3 "Search"). Submitting reloads
 * the page with `?q=...` (and `&kind=...` if a kind filter is active),
 * which the page itself reads via `searchParams` and passes to
 * `searchMinutes()`.
 */
export function SearchBox({ defaultValue = "", kind }: SearchBoxProps) {
  return (
    <form method="get" action="/members/records" className="flex gap-2">
      {kind && <input type="hidden" name="kind" value={kind} />}
      <label htmlFor="minutes-search-q" className="sr-only">
        Search minutes
      </label>
      <input
        id="minutes-search-q"
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search minutes by keyword or motion…"
        className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
      />
      <button
        type="submit"
        className="bg-lions-blue text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] flex-shrink-0"
      >
        Search
      </button>
    </form>
  );
}
