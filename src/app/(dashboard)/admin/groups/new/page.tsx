import { db } from "@/lib/db";
import { groupTypes } from "@/lib/db/schema";
import { GroupForm } from "@/components/admin/group-form";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

export default async function NewGroupPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const canAccess = await hasFeature(session.user.id, FEATURES.GROUPS_MANAGE);
  if (!canAccess) redirect("/admin");

  const types = await db.select().from(groupTypes);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">New Group</h1>
        <p className="mt-2 text-gray-600">Create a new committee, service team, or branch</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <GroupForm groupTypes={types} />
      </div>
    </div>
  );
}
