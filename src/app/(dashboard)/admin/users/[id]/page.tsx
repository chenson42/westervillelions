import { db } from "@/lib/db";
import { users, roles, userRoles, members } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import UserRoleManager from "@/components/admin/user-role-manager";
import { EditUserForm } from "@/components/admin/edit-user-form";
import { LinkMemberForm } from "@/components/admin/link-member-form";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

/**
 * User Role Management Page
 *
 * Assign and remove roles for a specific user.
 */
export default async function UserRolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.ADMIN_USERS);
  if (!canAccess) redirect("/admin");

  const { id } = await params;

  // Fetch user
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });

  if (!user) {
    notFound();
  }

  // Fetch all available roles
  const allRoles = await db
    .select()
    .from(roles)
    .orderBy(roles.sortOrder);

  // Fetch all active members for the link dropdown
  const allMembers = await db
    .select({ id: members.id, firstName: members.firstName, lastName: members.lastName })
    .from(members)
    .where(eq(members.isActive, true))
    .orderBy(asc(members.lastName), asc(members.firstName));

  // Fetch currently linked member name
  const linkedMember = user.memberId
    ? await db.query.members.findFirst({
        where: eq(members.id, user.memberId),
        columns: { firstName: true, lastName: true },
      })
    : null;
  const linkedMemberName = linkedMember
    ? `${linkedMember.firstName} ${linkedMember.lastName}`
    : null;

  // Fetch user's current roles
  const currentRoles = await db
    .select({
      roleId: userRoles.roleId,
      roleName: roles.name,
      roleDescription: roles.description,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, id));

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
          Manage User
        </h1>
      </div>

      {/* Edit user */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">User Information</h2>
        <p className="text-sm text-gray-500 mb-4">
          Joined {new Date(user.createdAt).toLocaleDateString()}
          {user.lastLoginAt && ` · Last login ${new Date(user.lastLoginAt).toLocaleDateString()}`}
        </p>
        <EditUserForm
          userId={user.id}
          initialName={user.name}
          initialEmail={user.email}
        />
      </div>

      {/* Member link */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Member Link</h2>
        <LinkMemberForm
          userId={user.id}
          linkedMemberId={user.memberId ?? null}
          linkedMemberName={linkedMemberName}
          allMembers={allMembers}
        />
      </div>

      {/* Role manager */}
      <UserRoleManager
        userId={id}
        allRoles={allRoles}
        currentRoleIds={currentRoleIds}
      />
    </div>
  );
}
