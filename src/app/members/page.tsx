import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function MembersPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const allMembers = await db.query.members.findMany({
    where: eq(members.isActive, true),
    orderBy: (members, { asc }) => [asc(members.lastName), asc(members.firstName)],
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-lions-red text-white py-12">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-2">Member Portal</h1>
          <p className="text-xl">Welcome, {session.user.name}!</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <a
            href="/members"
            className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition border-2 border-lions-red"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-red">Member Directory</h3>
            <p className="text-gray-700">View contact information for all club members</p>
          </a>
          <a
            href="/members/events"
            className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-red">Events</h3>
            <p className="text-gray-700">View and RSVP to upcoming club events</p>
          </a>
          <a
            href="/members/profile"
            className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition"
          >
            <h3 className="text-xl font-semibold mb-2 text-lions-red">My Profile</h3>
            <p className="text-gray-700">Update your contact information and preferences</p>
          </a>
        </div>

        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-2xl font-bold mb-6 text-gray-900">Member Directory</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {allMembers.map((member) => (
              <div key={member.id} className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {member.firstName} {member.lastName}
                </h3>
                {member.branch && (
                  <p className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">Branch:</span> {member.branch}
                  </p>
                )}
                {member.phone && (
                  <p className="text-sm text-gray-600 mb-1">
                    <span className="font-medium">Phone:</span> {member.phone}
                  </p>
                )}
                {member.memberNumber && (
                  <p className="text-xs text-gray-500 mt-2">
                    Member #{member.memberNumber}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
