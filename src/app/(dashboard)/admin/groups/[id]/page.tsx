import { db } from "@/lib/db";
import { groups, groupTypes, groupMemberships, groupRoles, members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { GroupForm } from "@/components/admin/group-form";
import { GroupMemberships } from "@/components/admin/group-memberships";

export default async function EditGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [group, types, memberships, allMembers, roles] = await Promise.all([
    db.query.groups.findFirst({ where: eq(groups.id, id) }) as Promise<typeof groups.$inferSelect | undefined>,
    db.select().from(groupTypes),
    db
      .select({
        id: groupMemberships.id,
        memberId: groupMemberships.memberId,
        firstName: members.firstName,
        lastName: members.lastName,
        groupRoleId: groupMemberships.groupRoleId,
        roleName: groupRoles.name,
        position: groupMemberships.position,
      })
      .from(groupMemberships)
      .innerJoin(members, eq(groupMemberships.memberId, members.id))
      .innerJoin(groupRoles, eq(groupMemberships.groupRoleId, groupRoles.id))
      .where(eq(groupMemberships.groupId, id)),
    db
      .select({ id: members.id, firstName: members.firstName, lastName: members.lastName })
      .from(members)
      .where(eq(members.isActive, true)),
    db.select().from(groupRoles),
  ]);

  if (!group) notFound();

  const existingMemberIds = new Set(memberships.map((m) => m.memberId));
  const availableMembers = allMembers.filter((m) => !existingMemberIds.has(m.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{group.name}</h1>
        <p className="mt-2 text-gray-600">Edit group details and manage members</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Group Details</h2>
        <GroupForm groupTypes={types} group={group as { id: string; name: string; description: string | null; groupTypeId: string; color: string | null; availablePositions: string | null; isActive: boolean }} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Members</h2>
        <GroupMemberships
          groupId={id}
          memberships={memberships}
          availableMembers={availableMembers}
          groupRoles={roles}
          availablePositions={group.availablePositions ? JSON.parse(group.availablePositions) : []}
        />
      </div>
    </div>
  );
}
