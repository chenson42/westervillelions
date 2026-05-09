import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const AVATAR_LIMIT = 5;

type GroupMember = {
  memberId: string;
  firstName: string;
  lastName: string;
  profilePicture: string | null;
  position: string | null;
};

export default async function GroupsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const [allGroups, membershipRows] = await Promise.all([
    db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        color: groups.color,
        emailPrefix: groups.emailPrefix,
      })
      .from(groups)
      .where(eq(groups.isActive, true))
      .orderBy(groups.name),
    db
      .select({
        groupId: groupMemberships.groupId,
        memberId: members.id,
        firstName: members.firstName,
        lastName: members.lastName,
        profilePicture: members.profilePicture,
        position: groupMemberships.position,
      })
      .from(groupMemberships)
      .innerJoin(members, eq(groupMemberships.memberId, members.id))
      .orderBy(members.lastName, members.firstName),
  ]);

  const membersByGroup = new Map<string, GroupMember[]>();
  for (const row of membershipRows) {
    const list = membersByGroup.get(row.groupId) ?? [];
    list.push({
      memberId: row.memberId,
      firstName: row.firstName,
      lastName: row.lastName,
      profilePicture: row.profilePicture,
      position: row.position,
    });
    membersByGroup.set(row.groupId, list);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Groups</h1>
          <p className="text-xl">Committees, service teams, and branches</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <div className="mb-6">
          <a href="/members" className="text-lions-blue hover:underline">
            &larr; Back to Member Portal
          </a>
        </div>

        {/* Club-wide email */}
        <div className="mb-8 flex items-center gap-4 rounded-xl border border-lions-gold/40 bg-lions-gold/5 px-6 py-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-700">Club-wide email list</p>
            <p className="text-sm text-gray-500 mt-0.5">Reaches all active members</p>
          </div>
          <a
            href="mailto:club@westervillelions.org"
            className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark hover:underline"
          >
            club@westervillelions.org
          </a>
        </div>

        {allGroups.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No groups have been set up yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {allGroups.map((group) => {
              const groupMembers = membersByGroup.get(group.id) ?? [];
              const visibleMembers = groupMembers.slice(0, AVATAR_LIMIT);
              const overflowCount = groupMembers.length - visibleMembers.length;
              return (
                <div
                  key={group.id}
                  className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden flex flex-col"
                >
                  {group.color && (
                    <div
                      className="h-1.5 w-full"
                      style={{ backgroundColor: group.color }}
                    />
                  )}
                  <div className="p-6 flex flex-col flex-1">
                    <a
                      href={`/members/groups/${group.id}`}
                      className="text-lg font-bold text-lions-blue mb-2 leading-snug hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      {group.name}
                    </a>
                    {group.description && (
                      <p className="text-gray-600 text-sm mb-4">
                        {group.description}
                      </p>
                    )}

                    <div className="mt-auto space-y-3 pt-2">
                      {groupMembers.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No members yet</p>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex -space-x-2">
                            {visibleMembers.map((member) => (
                              <div
                                key={member.memberId}
                                title={`${member.firstName} ${member.lastName}${member.position ? ` — ${member.position}` : ""}`}
                                className="h-9 w-9 rounded-full ring-2 ring-white overflow-hidden bg-lions-blue/10 flex items-center justify-center text-xs font-bold text-lions-blue"
                              >
                                {member.profilePicture ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={member.profilePicture}
                                    alt={`${member.firstName} ${member.lastName}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span>
                                    {member.firstName[0]}
                                    {member.lastName[0]}
                                  </span>
                                )}
                              </div>
                            ))}
                            {overflowCount > 0 && (
                              <div
                                title={`${overflowCount} more`}
                                className="h-9 w-9 rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600"
                              >
                                +{overflowCount}
                              </div>
                            )}
                          </div>
                          <a
                            href={`/members/groups/${group.id}`}
                            className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                          >
                            {groupMembers.length}{" "}
                            {groupMembers.length === 1 ? "member" : "members"}
                          </a>
                        </div>
                      )}

                      {group.emailPrefix && (
                        <a
                          href={`mailto:${group.emailPrefix}@westervillelions.org`}
                          className="block text-sm font-medium text-lions-blue hover:text-lions-blue-dark hover:underline break-all focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                        >
                          {group.emailPrefix}@westervillelions.org
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
