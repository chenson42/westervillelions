"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Group = { id: string; name: string; color: string | null };

interface MemberSearchProps {
  branches: string[];
  groups: Group[];
  currentSearch: string;
  currentBranch: string;
  currentStatus: string;
  currentGroup: string;
}

export default function MemberSearch({
  branches,
  groups,
  currentSearch,
  currentBranch,
  currentStatus,
  currentGroup,
}: MemberSearchProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(currentSearch);
  const [branch, setBranch] = useState(currentBranch);
  const [status, setStatus] = useState(currentStatus);
  const [group, setGroup] = useState(currentGroup);

  function applyFilters(newSearch: string, newBranch: string, newStatus: string, newGroup: string) {
    const params = new URLSearchParams();
    if (newSearch) params.set("search", newSearch);
    if (newBranch) params.set("branch", newBranch);
    if (newStatus && newStatus !== "active") params.set("status", newStatus);
    if (newGroup) params.set("group", newGroup);
    startTransition(() => {
      router.push(`/admin/members${params.size > 0 ? `?${params}` : ""}`);
    });
  }

  function handleBranchChange(value: string) {
    setBranch(value);
    applyFilters(search, value, status, group);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    applyFilters(search, branch, value, group);
  }

  function handleGroupChange(value: string) {
    setGroup(value);
    applyFilters(search, branch, status, value);
  }

  function handleClear() {
    setSearch("");
    setBranch("");
    setStatus("active");
    setGroup("");
    startTransition(() => router.push("/admin/members"));
  }

  const hasFilters = search || branch || status !== "active" || group;

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 ${isPending ? "opacity-70" : ""}`}>
      <div className="grid gap-4 sm:grid-cols-5">
        {/* Search input */}
        <div className="sm:col-span-2" onBlur={() => applyFilters(search, branch, status, group)}>
          <label htmlFor="search" className="sr-only">Search members</label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyFilters(search, branch, status, group);
            }}
          >
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <input
                type="text"
                id="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}

                className="block w-full rounded-md border border-gray-300 py-2 pl-10 pr-3 text-sm placeholder-gray-400 focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
                placeholder="Search by name or email..."
              />
            </div>
          </form>
        </div>

        {/* Branch filter */}
        <div>
          <label htmlFor="branch" className="sr-only">Filter by branch</label>
          <select
            id="branch"
            value={branch}
            onChange={(e) => handleBranchChange(e.target.value)}
            className="block w-full rounded-md border border-gray-300 py-2 pl-3 pr-10 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        {/* Group filter */}
        <div>
          <label htmlFor="group" className="sr-only">Filter by group</label>
          <select
            id="group"
            value={group}
            onChange={(e) => handleGroupChange(e.target.value)}
            className="block w-full rounded-md border border-gray-300 py-2 pl-3 pr-10 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
          >
            <option value="">All Groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        {/* Status filter + clear */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label htmlFor="status" className="sr-only">Filter by status</label>
            <select
              id="status"
              value={status}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="block w-full rounded-md border border-gray-300 py-2 pl-3 pr-10 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            >
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="all">All members</option>
            </select>
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
