import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

  // Ensure all fields are properly typed for the client component
  const membersWithDates = allMembers.map(member => ({
    ...member,
    email: member.email,
    joinDate: member.joinDate,
    boardPosition: member.boardPosition,
  }));

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

        <MemberDirectory members={membersWithDates} />
      </div>
    </div>
  );
}
