import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GroupDetailPage({ params }: Props) {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const { id } = await params;

  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      color: groups.color,
      emailPrefix: groups.emailPrefix,
    })
    .from(groups)
    .where(eq(groups.id, id))
    .limit(1);

  if (!group) {
    notFound();
  }

  const groupMembers = await db
    .select({
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      email: members.email,
      phone: members.phone,
      profilePicture: members.profilePicture,
      position: groupMemberships.position,
    })
    .from(groupMemberships)
    .innerJoin(members, eq(groupMemberships.memberId, members.id))
    .where(eq(groupMemberships.groupId, id))
    .orderBy(members.lastName, members.firstName);

  return (
    <div className="min-h-screen bg-gray-50">
      <div
        className="py-12 text-white bg-gradient-to-br from-lions-blue to-lions-blue-dark"
        style={
          group.color
            ? { background: `linear-gradient(135deg, ${group.color} 0%, #1e40af 100%)` }
            : undefined
        }
      >
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">{group.name}</h1>
          {group.description && (
            <p className="text-xl opacity-90">{group.description}</p>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <div className="mb-6">
          <a href="/members/groups" className="text-lions-blue hover:underline">
            &larr; Back to Groups
          </a>
        </div>

        {/* Contact email card */}
        {group.emailPrefix && (
          <div className="mb-8 rounded-2xl bg-white shadow-sm p-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
                Contact this group
              </p>
              <a
                href={`mailto:${group.emailPrefix}@westervillelions.org`}
                className="text-lg font-bold text-lions-blue hover:text-lions-blue-dark hover:underline break-all focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                {group.emailPrefix}@westervillelions.org
              </a>
            </div>
          </div>
        )}

        {/* Member list */}
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Members
          <span className="ml-2 text-base font-normal text-gray-500">
            ({groupMembers.length})
          </span>
        </h2>

        {groupMembers.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No members in this group yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {groupMembers.map((member) => (
              <div
                key={member.memberId}
                className="bg-white rounded-2xl shadow-sm p-5 flex items-center gap-4"
              >
                <div className="shrink-0">
                  {member.profilePicture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.profilePicture}
                      alt={`${member.firstName} ${member.lastName}`}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-lions-blue/10 flex items-center justify-center text-sm font-bold text-lions-blue">
                      {member.firstName[0]}
                      {member.lastName[0]}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 truncate">
                    {member.firstName} {member.lastName}
                  </p>
                  {member.position && (
                    <p className="text-xs text-lions-blue font-medium mb-0.5">
                      {member.position}
                    </p>
                  )}
                  {member.email && (
                    <a
                      href={`mailto:${member.email}`}
                      className="text-sm text-gray-500 hover:text-lions-blue hover:underline truncate block focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      {member.email}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
