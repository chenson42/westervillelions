import { db } from "@/lib/db";
import { members, groups, groupMemberships } from "@/lib/db/schema";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import Link from "next/link";
import MemberSearch from "@/components/admin/member-search";
import ExportMembersButton from "@/components/admin/export-members-button";
import SyncClubButton from "@/components/admin/sync-club-button";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; branch?: string; status?: string; group?: string }>;
}) {
  const { search = "", branch = "", status = "active", group: groupFilter = "" } = await searchParams;

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Members</h1>
          <p className="mt-2 text-gray-600">
            Manage club member directory and information
          </p>
        </div>
        <div className="flex items-center gap-3">
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
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {memberList.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <div className="text-gray-500">
                    <p className="text-lg font-medium">No members found</p>
                    <p className="mt-1 text-sm">Try adjusting your search or filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              memberList.map((member) => {
                const memberGroups = memberGroupsMap.get(member.id) || [];
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
                          member.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {member.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
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
        Showing {memberList.length} member{memberList.length !== 1 ? "s" : ""}
        {status !== "all" && ` (${status} only)`}
      </div>
    </div>
  );
}
