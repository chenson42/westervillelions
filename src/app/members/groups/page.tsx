import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export default async function GroupsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const allGroups = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      color: groups.color,
      emailPrefix: groups.emailPrefix,
    })
    .from(groups)
    .where(eq(groups.isActive, true))
    .orderBy(groups.name);

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

        {allGroups.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-10 text-center text-gray-500">
            No groups have been set up yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {allGroups.map((group) => (
              <div
                key={group.id}
                className="bg-white rounded-xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden flex flex-col"
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
                    <p className="text-gray-600 text-sm mb-4 flex-1">
                      {group.description}
                    </p>
                  )}
                  {group.emailPrefix && (
                    <a
                      href={`mailto:${group.emailPrefix}@westervillelions.org`}
                      className="inline-block mt-auto text-sm font-medium text-lions-blue hover:text-lions-blue-dark hover:underline break-all focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
                    >
                      {group.emailPrefix}@westervillelions.org
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
