import { db } from "@/lib/db";
import { roles, roleFeatures, features, userRoles } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";

/**
 * Roles List Page
 *
 * Overview of all roles in the system with their feature counts.
 */
export default async function RolesPage() {
  // Fetch all roles
  const allRoles = await db.select().from(roles).orderBy(roles.sortOrder);

  // Count features for each role
  const featureCounts = await db
    .select({
      roleId: roleFeatures.roleId,
      count: sql<number>`count(*)::int`,
    })
    .from(roleFeatures)
    .groupBy(roleFeatures.roleId);

  // Count users for each role
  const userCounts = await db
    .select({
      roleId: userRoles.roleId,
      count: sql<number>`count(*)::int`,
    })
    .from(userRoles)
    .groupBy(userRoles.roleId);

  // Create maps for easy lookup
  const featureCountMap = new Map(featureCounts.map((fc) => [fc.roleId, fc.count]));
  const userCountMap = new Map(userCounts.map((uc) => [uc.roleId, uc.count]));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Roles</h1>
          <p className="mt-2 text-gray-600">
            Overview of roles and their permissions
          </p>
        </div>
        <Link
          href="/admin/permissions"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
        >
          Edit Permissions
        </Link>
      </div>

      {/* Info card */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              Roles are assigned to users to control what features they can access.
              Use the <strong>Edit Permissions</strong> button to configure which
              features are available to each role.
            </p>
          </div>
        </div>
      </div>

      {/* Roles table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Features
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Users
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Priority
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {allRoles.map((role) => {
              const featureCount = featureCountMap.get(role.id) || 0;
              const userCount = userCountMap.get(role.id) || 0;

              return (
                <tr key={role.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <div className="font-medium text-gray-900">{role.name}</div>
                      {role.description && (
                        <div className="text-sm text-gray-500">
                          {role.description}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {role.name === "admin" ? (
                      <span className="text-green-600">All features (automatic)</span>
                    ) : (
                      `${featureCount} features`
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {userCount} user{userCount !== 1 ? "s" : ""}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {role.sortOrder}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
