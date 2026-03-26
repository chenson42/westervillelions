import { db } from "@/lib/db";
import { users, userRoles, roles, members } from "@/lib/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import Link from "next/link";
import { format } from "date-fns";

/**
 * Users List Page
 *
 * Displays all user accounts with their roles and status.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; role?: string; login?: string }>;
}) {
  const { search, role: roleFilter, login: loginFilter } = await searchParams;

  // Fetch all users with their roles
  const query = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      emailVerified: users.emailVerified,
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

  // Fetch member links
  const memberLinks = await db
    .select({
      userId: members.userId,
      memberName: members.firstName,
    })
    .from(members);

  // Group roles by user
  const userRolesMap = new Map<string, string[]>();
  userRoleData.forEach((ur) => {
    if (!userRolesMap.has(ur.userId)) {
      userRolesMap.set(ur.userId, []);
    }
    userRolesMap.get(ur.userId)!.push(ur.roleName);
  });

  // Map member links
  const memberLinkMap = new Map<string, string>();
  memberLinks.forEach((ml) => {
    if (ml.userId) {
      memberLinkMap.set(ml.userId, ml.memberName);
    }
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
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Joined
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Last Login
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredList.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <div className="text-gray-500">
                    <p className="text-lg font-medium">No users found</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredList.map((user) => {
                const userRolesList = userRolesMap.get(user.id) || [];
                const linkedMember = memberLinkMap.get(user.id);

                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div>
                        <div className="font-medium text-gray-900">
                          {user.name || user.email}
                        </div>
                        <div className="text-sm text-gray-500">{user.email}</div>
                        {linkedMember && (
                          <div className="mt-1 text-xs text-green-600">
                            🦁 Linked to member
                          </div>
                        )}
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
                      <span
                        className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                          user.emailVerified
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {user.emailVerified ? "Verified" : "Unverified"}
                      </span>
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
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="text-lions-blue hover:text-lions-blue-dark"
                      >
                        Manage Roles
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500">
        Showing {filteredList.length} of {userList.length} user{userList.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
