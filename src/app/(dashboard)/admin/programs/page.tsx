import { db } from "@/lib/db";
import { glassesDropoffLocations } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import LocationsManager from "./locations-manager";

export default async function AdminProgramsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canManage = await hasFeature(session.user.id, FEATURES.ANNOUNCEMENTS_MANAGE);
  if (!canManage) redirect("/admin");

  const locations = await db
    .select()
    .from(glassesDropoffLocations)
    .orderBy(asc(glassesDropoffLocations.sortOrder), asc(glassesDropoffLocations.createdAt));

  return <LocationsManager initialLocations={locations} />;
}
