import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import Link from "next/link";
import MemberSearch from "@/components/admin/member-search";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; branch?: string; status?: string }>;
}) {
  const { search = "", branch = "", status = "active" } = await searchParams;

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
  // status === "all" → no filter

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
        <Link
          href="/admin/members/new"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Add Member
        </Link>
      </div>

      {/* Search and filters */}
      <MemberSearch
        branches={branches.map((b) => b.branch || "").filter(Boolean)}
        currentSearch={search}
        currentBranch={branch}
        currentStatus={status}
      />

      {/* Members table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Phone
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
              memberList.map((member) => (
                <tr
                  key={member.id}
                  className={`hover:bg-gray-50 ${!member.isActive ? "opacity-60" : ""}`}
                >
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="font-medium text-gray-900">
                      {member.firstName} {member.lastName}
                    </div>
                    {member.boardPosition && (
                      <div className="text-sm text-gray-500">{member.boardPosition}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {member.email || "—"}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {member.phone || "—"}
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500">
        Showing {memberList.length} member{memberList.length !== 1 ? "s" : ""}
        {status !== "all" && ` (${status} only)`}
      </div>
    </div>
  );
}
