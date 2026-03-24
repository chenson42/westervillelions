import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { members, groups, groupMemberships } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { MemberDirectory } from "@/components/members/member-directory";

export default async function MembersPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const allMembers = await db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (members, { asc }) => [asc(members.lastName), asc(members.firstName)],
  });

  // Fetch groups that are shown in directory
  const directoryGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      color: groups.color,
      showPositionAsTag: groups.showPositionAsTag,
    })
    .from(groups)
    .where(and(eq(groups.isActive, true), eq(groups.showInDirectory, true)));

  // Fetch memberships for those groups
  const memberIds = allMembers.map((m) => m.id);
  const directoryGroupIds = directoryGroups.map((g) => g.id);

  const memberGroupData =
    memberIds.length > 0 && directoryGroupIds.length > 0
      ? await db
          .select({
            memberId: groupMemberships.memberId,
            groupId: groupMemberships.groupId,
            position: groupMemberships.position,
          })
          .from(groupMemberships)
          .where(
            and(
              inArray(groupMemberships.memberId, memberIds),
              inArray(groupMemberships.groupId, directoryGroupIds)
            )
          )
      : [];

  // Build a map of memberId -> group tag info
  const groupMap = new Map(directoryGroups.map((g) => [g.id, g]));
  const memberTagsMap = new Map<string, { groupId: string; groupName: string; color: string | null; tag: string }[]>();
  for (const row of memberGroupData) {
    const group = groupMap.get(row.groupId);
    if (!group) continue;
    const tag = group.showPositionAsTag && row.position ? row.position : group.name;
    if (!memberTagsMap.has(row.memberId)) memberTagsMap.set(row.memberId, []);
    memberTagsMap.get(row.memberId)!.push({
      groupId: row.groupId,
      groupName: group.name,
      color: group.color,
      tag,
    });
  }

  const membersWithTags = allMembers.map((member) => ({
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    email: member.email,
    phone: member.phone,
    branch: member.branch,
    memberNumber: member.memberNumber,
    joinDate: member.joinDate,
    groupTags: memberTagsMap.get(member.id) ?? [],
  }));

  // Groups available as filters (those that have at least one member)
  const filterGroups = directoryGroups.map((g) => ({ id: g.id, name: g.name, color: g.color }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Member Portal</h1>
          <p className="text-xl">Welcome, {session.user.name}!</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <a
            href="/members"
            className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition border-2 border-lions-blue transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Member Directory</h3>
            <p className="text-gray-700">View contact information for all club members</p>
          </a>
          <a
            href="/members/events"
            className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">Events</h3>
            <p className="text-gray-700">View and RSVP to upcoming club events</p>
          </a>
          <a
            href="/members/profile"
            className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-blue">My Profile</h3>
            <p className="text-gray-700">Update your contact information and preferences</p>
          </a>
        </div>

        <MemberDirectory members={membersWithTags} filterGroups={filterGroups} />
      </div>
    </div>
  );
}
