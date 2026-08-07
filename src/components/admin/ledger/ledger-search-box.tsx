/**
 * Quick-search box mounted on the /admin/ledger dashboard AND persisted atop
 * the /admin/ledger/search results page for re-querying (Treasurer Decision
 * 1, docs/work-log/2026-08-06-ledger-search.md). Plain GET <form>, zero JS —
 * per Phase 2/3 the dashboard needs no client state to answer "what's the
 * search term," and a GET form navigates to ?q=... on its own. Degrades
 * automatically with the rest of the dashboard: this component only ever
 * renders inside LedgerDashboard's success branch, so if getDashboard()
 * throws, LoadErrorCard renders instead and the box simply doesn't appear
 * (Phase 1 Flow 0's stated failure behavior).
 */
export default function LedgerSearchBox({
  defaultValue = "",
}: {
  /** Persist the current term when this box is reused on the results page. */
  defaultValue?: string;
}) {
  return (
    <form
      method="GET"
      action="/admin/ledger/search"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <label htmlFor="ledger-search-q" className="sr-only">
        Search transactions and budget lines
      </label>
      <div className="relative flex-1">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          id="ledger-search-q"
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search transactions and budget lines… e.g. WARM"
          className="block w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
        />
      </div>
      <button
        type="submit"
        className="bg-lions-blue text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] whitespace-nowrap"
      >
        Search
      </button>
    </form>
  );
}
