"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

export default function MemberSearch({ branches }: { branches: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [branch, setBranch] = useState(searchParams.get("branch") || "");

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (branch) params.set("branch", branch);

    const queryString = params.toString();
    router.push(`/admin/members${queryString ? `?${queryString}` : ""}`);
  }, [search, branch, router]);

  const handleClear = () => {
    setSearch("");
    setBranch("");
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Search input */}
        <div className="sm:col-span-2">
          <label htmlFor="search" className="sr-only">
            Search members
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
            </div>
            <input
              type="text"
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm placeholder-gray-400 focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
              placeholder="Search by name or email..."
            />
          </div>
        </div>

        {/* Branch filter */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="branch" className="sr-only">
              Filter by branch
            </label>
            <select
              id="branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="block w-full rounded-md border border-gray-300 py-2 pl-3 pr-10 text-sm focus:border-lions-red focus:outline-none focus:ring-1 focus:ring-lions-red"
            >
              <option value="">All Branches</option>
              {branches
                .filter((b) => b)
                .map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
            </select>
          </div>

          {/* Clear button */}
          {(search || branch) && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-red focus:ring-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
