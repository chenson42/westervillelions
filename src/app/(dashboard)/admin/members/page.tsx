import { db } from "@/lib/db";
import { members, groups, groupMemberships } from "@/lib/db/schema";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import MemberSearch from "@/components/admin/member-search";
import ExportMembersButton from "@/components/admin/export-members-button";
import SyncClubButton from "@/components/admin/sync-club-button";
import DuesStatusBadge from "@/components/admin/dues-status-badge";
import { listMemberDuesStatus, getActiveFiscalYear } from "@/lib/dues-queries";
import type { DuesStatus } from "@/lib/dues";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    branch?: string;
    status?: string;
    group?: string;
    duesStatus?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.MEMBERS_EDIT);
  if (!canAccess) redirect("/admin");

  // Dues visibility is opt-in based on DUES_VIEW feature
  const canViewDues = await hasFeature(session.user.id, FEATURES.DUES_VIEW);

  const {
    search = "",
    branch = "",
    status = "active",
    group: groupFilter = "",
    duesStatus = "",
  } = await searchParams;

  // Build conditions
  const conditions = [];

  if (search) {
    conditions.push(
      or(
        like(members.firstName, `%${search}%`),
        like(members.lastName, `%${search}%`),
        like(members.email, `%${search}%`)
      )
    );
  }

  if (branch) {
    conditions.push(eq(members.branch, branch));
  }

  if (status === "active") {
    conditions.push(eq(members.isActive, true));
  } else if (status === "inactive") {
    conditions.push(eq(members.isActive, false));
  } else if (status === "prospective") {
    conditions.push(eq(members.membershipStatus, "prospective"));
  } else if (status === "ended") {
    conditions.push(eq(members.membershipStatus, "ended"));
  }

  // Group filter: get member IDs in that group first
  let groupFilterMemberIds: string[] | null = null;
  if (groupFilter) {
    const inGroup = await db
      .select({ memberId: groupMemberships.memberId })
      .from(groupMemberships)
      .where(eq(groupMemberships.groupId, groupFilter));
    groupFilterMemberIds = inGroup.map((g) => g.memberId);
    if (groupFilterMemberIds.length > 0) {
      conditions.push(inArray(members.id, groupFilterMemberIds));
    } else {
      // Group exists but has no members — return empty
      conditions.push(eq(members.id, "00000000-0000-0000-0000-000000000000"));
    }
  }

  const memberList = await db
    .select()
    .from(members)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(members.lastName, members.firstName);

  // Get unique branches for filter
  const branches = await db
    .selectDistinct({ branch: members.branch })
    .from(members)
    .where(sql`${members.branch} IS NOT NULL`);

  // Get all active groups for filter
  const allGroups = await db
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(groups)
    .where(eq(groups.isActive, true))
    .orderBy(groups.name);

  // Get group memberships for listed members (for color badges)
  const memberIds = memberList.map((m) => m.id);
  const memberGroupData = memberIds.length > 0
    ? await db
        .select({
          memberId: groupMemberships.memberId,
          groupId: groups.id,
          groupName: groups.name,
          groupColor: groups.color,
          position: groupMemberships.position,
        })
        .from(groupMemberships)
        .innerJoin(groups, eq(groupMemberships.groupId, groups.id))
        .where(and(inArray(groupMemberships.memberId, memberIds), eq(groups.isActive, true)))
    : [];

  // Map member ID → groups
  const memberGroupsMap = new Map<string, typeof memberGroupData>();
  for (const row of memberGroupData) {
    if (!memberGroupsMap.has(row.memberId)) memberGroupsMap.set(row.memberId, []);
    memberGroupsMap.get(row.memberId)!.push(row);
  }

  // ---- Dues status integration (DUES_VIEW gate) ----
  // Performance note: listMemberDuesStatus fetches all active members for the FY
  // regardless of the current search/branch/group filters on the member list.
  // This is intentional — the dues map must cover all members so any member in
  // the filtered list can be looked up. At club scale (50-200 members) this is
  // a single aggregate SQL query and adds minimal overhead.
  const fy = await getActiveFiscalYear();
  const duesStatusMap = new Map<string, DuesStatus>();

  if (canViewDues) {
    const duesSummary = await listMemberDuesStatus(fy);
    for (const d of duesSummary) {
      duesStatusMap.set(d.memberId, d.status);
    }
  }

  // Apply dues status filter in TypeScript (only when the viewer has dues access)
  const effectiveDuesStatus = canViewDues && duesStatus ? (duesStatus as DuesStatus) : "";

  const filteredMembers = effectiveDuesStatus
    ? memberList.filter((m) => duesStatusMap.get(m.id) === effectiveDuesStatus)
    : memberList;

  const DUES_STATUS_OPTIONS = [
    { value: "", label: "All Dues" },
    { value: "paid", label: "Paid" },
    { value: "partial", label: "Partial" },
    { value: "unpaid", label: "Unpaid" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Members</h1>
          <p className="mt-2 text-gray-600">
            Manage club member directory and information
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <SyncClubButton />
          <ExportMembersButton />
          <Link
            href="/admin/members/new"
            className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
          >
            Add Member
          </Link>
        </div>
      </div>

      {/* Search and filters */}
      <MemberSearch
        branches={branches.map((b) => b.branch || "").filter(Boolean)}
        groups={allGroups}
        currentSearch={search}
        currentBranch={branch}
        currentStatus={status}
        currentGroup={groupFilter}
      />

      {/* Dues status filter — only when viewer has DUES_VIEW */}
      {canViewDues && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500 font-medium">Dues:</span>
          {DUES_STATUS_OPTIONS.map((opt) => {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            if (branch) params.set("branch", branch);
            if (status !== "active") params.set("status", status);
            if (groupFilter) params.set("group", groupFilter);
            if (opt.value) params.set("duesStatus", opt.value);
            const href = `/admin/members${params.size > 0 ? `?${params}` : ""}`;
            const isActive = effectiveDuesStatus === opt.value;
            return (
              <a
                key={opt.value}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[36px] inline-flex items-center ${
                  isActive
                    ? "bg-lions-blue text-white"
                    : "bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
                }`}
              >
                {opt.label}
              </a>
            );
          })}
          {effectiveDuesStatus && (
            <span className="text-xs text-gray-400">
              — FY{fy} filter active
            </span>
          )}
        </div>
      )}

      {/* Members table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Groups
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Branch
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
              {canViewDues && (
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Dues
                </th>
              )}
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={canViewDues ? 7 : 6} className="px-6 py-12 text-center">
                  <div className="text-gray-500">
                    <p className="text-lg font-medium">No members found</p>
                    <p className="mt-1 text-sm">Try adjusting your search or filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const memberGroups = memberGroupsMap.get(member.id) || [];
                const memberDuesStatus = canViewDues ? duesStatusMap.get(member.id) : undefined;
                return (
                  <tr
                    key={member.id}
                    className={`hover:bg-gray-50 ${!member.isActive ? "opacity-60" : ""}`}
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {member.firstName} {member.lastName}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {memberGroups.map((g) => (
                          <span
                            key={g.groupId}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: g.groupColor || "#6b7280" }}
                            title={g.position ? `${g.groupName}: ${g.position}` : g.groupName}
                          >
                            {g.position || g.groupName}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {member.email || "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {member.branch || "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                          member.membershipStatus === "active"
                            ? "bg-green-100 text-green-800"
                            : member.membershipStatus === "prospective"
                            ? "bg-lions-gold/20 text-lions-blue-dark"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {member.membershipStatus === "active"
                          ? "Active"
                          : member.membershipStatus === "prospective"
                          ? "Prospective"
                          : "Ended"}
                      </span>
                    </td>
                    {canViewDues && (
                      <td className="whitespace-nowrap px-6 py-4">
                        {memberDuesStatus ? (
                          <DuesStatusBadge status={memberDuesStatus} />
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="text-lions-blue hover:text-lions-blue-dark"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500">
        Showing {filteredMembers.length}
        {filteredMembers.length !== memberList.length && ` of ${memberList.length}`}{" "}
        member{filteredMembers.length !== 1 ? "s" : ""}
        {status !== "all" && ` (${status} only)`}
      </div>
    </div>
  );
}
