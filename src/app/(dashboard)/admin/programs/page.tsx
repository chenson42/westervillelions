import { db } from "@/lib/db";
import { glassesDropoffLocations, plasticDropoffLocations } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import LocationsManager from "./locations-manager";
import PlasticLocationsManager from "./plastic-locations-manager";

export default async function AdminProgramsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
  if (!canManage) redirect("/admin");

  const [glassesLocations, plasticLocations] = await Promise.all([
    db
      .select()
      .from(glassesDropoffLocations)
      .orderBy(asc(glassesDropoffLocations.sortOrder), asc(glassesDropoffLocations.createdAt)),
    db
      .select()
      .from(plasticDropoffLocations)
      .orderBy(asc(plasticDropoffLocations.sortOrder), asc(plasticDropoffLocations.createdAt)),
  ]);

  return (
    <div className="space-y-12">
      <LocationsManager initialLocations={glassesLocations} />
      <hr className="border-gray-200" />
      <PlasticLocationsManager initialLocations={plasticLocations} />
    </div>
  );
}
