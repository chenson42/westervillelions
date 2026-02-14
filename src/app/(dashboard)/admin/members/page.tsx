import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { desc, like, or, sql } from "drizzle-orm";
import Link from "next/link";
import MemberSearch from "@/components/admin/member-search";

/**
 * Member List Page
 *
 * Displays all club members with search and filtering capabilities.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: { search?: string; branch?: string };
}) {
  const search = searchParams.search || "";
  const branch = searchParams.branch || "";

  // Build query
  let query = db.select().from(members);

  // Apply search filter
  if (search) {
    query = query.where(
      or(
        like(members.firstName, `%${search}%`),
        like(members.lastName, `%${search}%`),
        like(members.email, `%${search}%`)
      )
    ) as typeof query;
  }

  // Apply branch filter
  if (branch) {
    query = query.where(like(members.branch, `%${branch}%`)) as typeof query;
  }

  // Order by last name
  const memberList = await query.orderBy(members.lastName, members.firstName);

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
          className="rounded-md bg-lions-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
        >
          Add Member
        </Link>
      </div>

      {/* Search and filters */}
      <MemberSearch branches={branches.map((b) => b.branch || "")} />

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
                    {search && (
                      <p className="mt-1 text-sm">
                        Try adjusting your search criteria
                      </p>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              memberList.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="flex items-center">
                      <div>
                        <div className="font-medium text-gray-900">
                          {member.firstName} {member.lastName}
                        </div>
                        {member.boardPosition && (
                          <div className="text-sm text-gray-500">
                            {member.boardPosition}
                          </div>
                        )}
                      </div>
                    </div>
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
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {member.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                    <Link
                      href={`/admin/members/${member.id}`}
                      className="text-lions-red hover:text-red-900"
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
      </div>
    </div>
  );
}
