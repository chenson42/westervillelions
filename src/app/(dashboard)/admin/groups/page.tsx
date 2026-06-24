import { db } from "@/lib/db";
import { groups, groupTypes } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export default async function AdminGroupsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
  if (!canAccess) redirect("/admin");

  const groupList = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      isActive: groups.isActive,
      typeName: groupTypes.name,
    })
    .from(groups)
    .innerJoin(groupTypes, eq(groups.groupTypeId, groupTypes.id))
    .orderBy(asc(groupTypes.name), asc(groups.name));

  // Group by type for display
  const byType = groupList.reduce<Record<string, typeof groupList>>((acc, g) => {
    if (!acc[g.typeName]) acc[g.typeName] = [];
    acc[g.typeName].push(g);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Groups</h1>
          <p className="mt-2 text-gray-600">Manage committees, service teams, and branches</p>
        </div>
        <Link
          href="/admin/groups/new"
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lions-blue-dark"
        >
          New Group
        </Link>
      </div>

      {groupList.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-lg font-medium text-gray-500">No groups yet</p>
          <p className="mt-1 text-sm text-gray-400">Create committees, service teams, and branches to organize your members.</p>
          <Link href="/admin/groups/new" className="mt-4 inline-block rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark">
            Create First Group
          </Link>
        </div>
      ) : (
        Object.entries(byType).map(([typeName, typeGroups]) => (
          <div key={typeName} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">{typeName}s</h2>
            </div>
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {typeGroups.map((group) => (
                  <tr key={group.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{group.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{group.description || "—"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${group.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>
                        {group.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium">
                      <Link href={`/admin/groups/${group.id}`} className="text-lions-blue hover:text-lions-blue-dark">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
