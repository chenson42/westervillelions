import { db } from "@/lib/db";
import { users, roles, userRoles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import UserRoleManager from "@/components/admin/user-role-manager";

/**
 * User Role Management Page
 *
 * Assign and remove roles for a specific user.
 */
export default async function UserRolePage({
  params,
}: {
  params: { id: string };
}) {
  // Fetch user
  const user = await db.query.users.findFirst({
    where: eq(users.id, params.id),
  });

  if (!user) {
    notFound();
  }

  // Fetch all available roles
  const allRoles = await db
    .select()
    .from(roles)
    .orderBy(roles.sortOrder);

  // Fetch user's current roles
  const currentRoles = await db
    .select({
      roleId: userRoles.roleId,
      roleName: roles.name,
      roleDescription: roles.description,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, params.id));

  const currentRoleIds = currentRoles.map((r) => r.roleId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/users" className="hover:text-gray-900">
            Users
          </Link>
          <span>/</span>
          <span className="text-gray-900">{user.name || user.email}</span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">
          Manage User Roles
        </h1>
      </div>

      {/* User info */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">User Information</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Name:</dt>
            <dd className="font-medium text-gray-900">{user.name || "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Email:</dt>
            <dd className="font-medium text-gray-900">{user.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Joined:</dt>
            <dd className="font-medium text-gray-900">
              {new Date(user.createdAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </div>

      {/* Role manager */}
      <UserRoleManager
        userId={params.id}
        allRoles={allRoles}
        currentRoleIds={currentRoleIds}
      />
    </div>
  );
}
