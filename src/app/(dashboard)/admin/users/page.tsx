import { db } from "@/lib/db";
import { users, userRoles, roles, members, accounts } from "@/lib/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import Link from "next/link";
import { format } from "date-fns";
import { SuspendUserButton } from "@/components/admin/suspend-user-button";

/**
 * Users List Page
 *
 * Displays all user accounts with their roles, account type, and member link status.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; role?: string; login?: string }>;
}) {
  const { search, role: roleFilter, login: loginFilter } = await searchParams;

  // Fetch all users
  const query = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(users.createdAt);

  const userList = search
    ? await query.where(or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`)))
    : await query;

  // Fetch roles for each user
  const userRoleData = await db
    .select({
      userId: userRoles.userId,
      roleName: roles.name,
      sortOrder: roles.sortOrder,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .orderBy(roles.sortOrder);

  // Fetch member links (users.member_id → members.first_name)
  const memberLinks = await db
    .select({
      userId: users.id,
      memberId: users.memberId,
      memberName: members.firstName,
    })
    .from(users)
    .innerJoin(members, eq(users.memberId, members.id));

  // Fetch OAuth providers (left join — password users have no account row)
  const accountData = await db
    .select({
      userId: accounts.userId,
      provider: accounts.provider,
    })
    .from(accounts);

  // Group roles by user
  const userRolesMap = new Map<string, string[]>();
  userRoleData.forEach((ur) => {
    if (!userRolesMap.has(ur.userId)) userRolesMap.set(ur.userId, []);
    userRolesMap.get(ur.userId)!.push(ur.roleName);
  });

  // Map member links
  const memberLinkMap = new Map<string, string>();
  memberLinks.forEach((ml) => {
    if (ml.userId) memberLinkMap.set(ml.userId, ml.memberName);
  });

  // Map provider by user (first account wins)
  const providerMap = new Map<string, string>();
  accountData.forEach((a) => {
    if (!providerMap.has(a.userId)) providerMap.set(a.userId, a.provider);
  });

  // Get all role names for the filter dropdown
  const allRoles = await db.select({ name: roles.name }).from(roles).orderBy(roles.sortOrder);

  // Apply role + login filters
  const filteredList = userList.filter((u) => {
    if (roleFilter) {
      const userRolesList = userRolesMap.get(u.id) || [];
      const roleMatch = roleFilter === "none" ? userRolesList.length === 0 : userRolesList.includes(roleFilter);
      if (!roleMatch) return false;
    }
    if (loginFilter === "yes" && !u.lastLoginAt) return false;
    if (loginFilter === "never" && u.lastLoginAt) return false;
    return true;
  });

  const unlinkedCount = filteredList.filter((u) => !memberLinkMap.has(u.id)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Users</h1>
          <p className="mt-2 text-gray-600">
            Manage user accounts and role assignments
          </p>
        </div>
      </div>

      {/* Unlinked users alert */}
      {unlinkedCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="font-semibold text-amber-800">
              {unlinkedCount} user{unlinkedCount !== 1 ? "s" : ""} not linked to a member record
            </p>
            <p className="mt-0.5 text-sm text-amber-700">
              These accounts can log in but won&apos;t have access to member-only features. Review and link them to a member record from the Members admin page.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <form method="GET" className="flex gap-3">
        <input
          type="text"
          name="search"
          defaultValue={search || ""}
          placeholder="Search by name or email..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        />
        <select
          name="role"
          defaultValue={roleFilter || ""}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        >
          <option value="">All roles</option>
          <option value="none">No roles assigned</option>
          {allRoles.map((r) => (
            <option key={r.name} value={r.name}>{r.name}</option>
          ))}
        </select>
        <select
          name="login"
          defaultValue={loginFilter || ""}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        >
          <option value="">All login activity</option>
          <option value="yes">Has logged in</option>
          <option value="never">Never logged in</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark"
        >
          Filter
        </button>
        {(search || roleFilter || loginFilter) && (
          <Link
            href="/admin/users"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Users table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Roles
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Account Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Member Record
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Joined
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Last Login
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
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center">
                  <div className="text-gray-500">
                    <p className="text-lg font-medium">No users found</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredList.map((user) => {
                const userRolesList = userRolesMap.get(user.id) || [];
                const linkedMember = memberLinkMap.get(user.id);
                const provider = providerMap.get(user.id);
                const isLinked = !!linkedMember;

                return (
                  <tr key={user.id} className={`hover:bg-gray-50 ${!user.isActive ? "bg-red-50/30" : !isLinked ? "bg-amber-50/40" : ""}`}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        <div className="font-medium text-gray-900">
                          {user.name || user.email}
                        </div>
                        <div className="text-sm text-gray-500">{user.email}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {userRolesList.length > 0 ? (
                          userRolesList.map((role) => (
                            <span
                              key={role}
                              className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
                            >
                              {role}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-gray-400">No roles</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {provider === "google" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                          </svg>
                          Google
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                          Password
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {isLinked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          ✓ {linkedMember}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          ⚠ Not linked
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {user.lastLoginAt ? (
                        <span className="text-gray-500">
                          {format(new Date(user.lastLoginAt), "MMM d, yyyy h:mm a")}
                        </span>
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {user.isActive ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                          Suspended
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-4">
                        <Link
                          href={`/admin/users/${user.id}`}
                          className="text-lions-blue hover:text-lions-blue-dark"
                        >
                          Manage Roles
                        </Link>
                        <SuspendUserButton
                          userId={user.id}
                          userName={user.name ?? user.email}
                          isActive={user.isActive}
                        />
                      </div>
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
        Showing {filteredList.length} of {userList.length} user{userList.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
