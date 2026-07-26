"use client";

import { useState, useMemo } from "react";
import { ShadowAvatar } from "./shadow-avatar";

interface GroupTag {
  groupId: string;
  groupName: string;
  color: string | null;
  tag: string;
}

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  branch: string | null;
  memberNumber: number | null;
  joinDate: Date | null;
  profilePicture: string | null;
  membershipStatus: "active" | "prospective" | "ended";
  groupTags: GroupTag[];
}

interface FilterGroup {
  id: string;
  name: string;
  color: string | null;
}

function getYearsOfService(joinDate: Date | null): number {
  if (!joinDate) return 0;
  const today = new Date();
  const joined = new Date(joinDate);
  return today.getFullYear() - joined.getFullYear();
}

function getServiceBadge(years: number): { label: string; color: string } | null {
  if (years >= 50) return { label: "50+ Years", color: "bg-purple-100 text-purple-800" };
  if (years >= 25) return { label: "25+ Years", color: "bg-gold-100 text-yellow-800" };
  if (years >= 10) return { label: "10+ Years", color: "bg-blue-100 text-blue-800" };
  if (years >= 5) return { label: "5+ Years", color: "bg-green-100 text-green-800" };
  return null;
}

interface MemberDirectoryProps {
  members: Member[];
  filterGroups: FilterGroup[];
}

export function MemberDirectory({ members, filterGroups }: MemberDirectoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBranch, setFilterBranch] = useState<string>("main");
  const [filterGroupId, setFilterGroupId] = useState<string>("");

  // Get unique branches
  const branches = useMemo(() => {
    const uniqueBranches = new Set<string>();
    members.forEach((member) => {
      if (member.branch) uniqueBranches.add(member.branch);
    });
    return Array.from(uniqueBranches).sort();
  }, [members]);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        searchQuery === "" ||
        member.firstName.toLowerCase().includes(searchLower) ||
        member.lastName.toLowerCase().includes(searchLower) ||
        `${member.firstName} ${member.lastName}`.toLowerCase().includes(searchLower) ||
        member.email?.toLowerCase().includes(searchLower) ||
        member.phone?.toLowerCase().includes(searchLower) ||
        member.memberNumber?.toString().includes(searchQuery);

      // Branch/group filter
      let matchesBranch = true;
      if (filterBranch === "all") {
        matchesBranch = true;
      } else if (filterBranch === "main") {
        matchesBranch = !member.branch;
      } else {
        matchesBranch = member.branch === filterBranch;
      }

      // Group filter
      const matchesGroup =
        !filterGroupId || member.groupTags.some((g) => g.groupId === filterGroupId);

      return matchesSearch && matchesBranch && matchesGroup;
    });
  }, [members, searchQuery, filterBranch, filterGroupId]);

  return (
    <div className="bg-white rounded-xl shadow-lg p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Member Directory</h2>
          <p className="text-gray-600 mt-1">
            {filteredMembers.length} of {members.length} members
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="mb-8 space-y-4">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg
              className="h-5 w-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, phone, or member number..."
            className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-blue focus:border-transparent text-lg"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Branch Filter */}
        {branches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterBranch("main")}
              className={`px-4 py-2 rounded-full font-medium transition ${
                filterBranch === "main"
                  ? "bg-lions-blue text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Main Club
            </button>
            {branches.map((branch) => (
              <button
                key={branch}
                onClick={() => setFilterBranch(branch)}
                className={`px-4 py-2 rounded-full font-medium transition ${
                  filterBranch === branch
                    ? "bg-lions-blue text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                {branch}
              </button>
            ))}
            <button
              onClick={() => setFilterBranch("all")}
              className={`px-4 py-2 rounded-full font-medium transition ${
                filterBranch === "all"
                  ? "bg-lions-blue text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              All Members
            </button>
          </div>
        )}

        {/* Group Filter */}
        {filterGroups.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-500 font-medium">Filter by group:</span>
            {filterGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => setFilterGroupId(filterGroupId === g.id ? "" : g.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  filterGroupId === g.id
                    ? "text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
                style={filterGroupId === g.id ? { backgroundColor: g.color ?? "#1a56db" } : undefined}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Members Grid */}
      {filteredMembers.length > 0 ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMembers.map((member) => {
            const yearsOfService = getYearsOfService(member.joinDate);
            const serviceBadge = getServiceBadge(yearsOfService);

            return (
              <div
                key={member.id}
                className="border border-gray-200 rounded-xl p-5 hover:shadow-lg transition transform hover:-translate-y-1"
              >
                <div className="flex items-start gap-3 mb-3">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border border-gray-200">
                    {member.profilePicture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.profilePicture}
                        alt={`${member.firstName} ${member.lastName}`}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <ShadowAvatar className="w-12 h-12 rounded-full" />
                    )}
                  </div>
                  <div className="flex flex-1 items-start justify-between">
                  <h3 className="text-lg font-bold text-gray-900">
                    {member.firstName} {member.lastName}
                  </h3>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {member.membershipStatus === "prospective" && (
                      <span className="px-2 py-1 bg-lions-gold/20 text-lions-blue-dark text-xs font-semibold rounded-full whitespace-nowrap">
                        Prospective
                      </span>
                    )}
                    {member.groupTags.map((g) => (
                      <span
                        key={g.groupId}
                        className="px-2 py-1 text-white text-xs font-medium rounded-full whitespace-nowrap"
                        style={{ backgroundColor: g.color ?? "#1a56db" }}
                        title={g.groupName}
                      >
                        {g.tag}
                      </span>
                    ))}
                    {member.branch && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full">
                        {member.branch}
                      </span>
                    )}
                    {serviceBadge && (
                      <span className={`px-2 py-1 ${serviceBadge.color} text-xs font-medium rounded-full whitespace-nowrap`}>
                        {serviceBadge.label}
                      </span>
                    )}
                  </div>
                  </div>
                </div>
              {member.email && (
                <p className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <a href={`mailto:${member.email}`} className="hover:text-lions-blue truncate">
                    {member.email}
                  </a>
                </p>
              )}
              {member.phone && (
                <p className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  <a href={`tel:${member.phone}`} className="hover:text-lions-blue">
                    {member.phone}
                  </a>
                </p>
              )}
              <div className="flex items-center justify-between mt-3">
                {member.memberNumber && (
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      />
                    </svg>
                    Member #{member.memberNumber}
                  </p>
                )}
                {yearsOfService > 0 && (
                  <p className="text-xs text-gray-500">
                    {yearsOfService} {yearsOfService === 1 ? 'year' : 'years'}
                  </p>
                )}
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No members found</h3>
          <p className="text-gray-500">
            Try adjusting your search or filter criteria
          </p>
        </div>
      )}
    </div>
  );
}
