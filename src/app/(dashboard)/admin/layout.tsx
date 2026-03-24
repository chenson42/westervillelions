import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { FEATURES } from "@/lib/permissions";
import AdminSidebar from "@/components/admin/admin-sidebar";

/**
 * Admin Layout
 *
 * Wraps all admin pages with a consistent sidebar navigation.
 * Requires at least one admin feature to access.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/signin");
  }

  const userFeatures = session.user.features || [];
  const userRoles = session.user.roles || [];
  const isAdmin = session.user.role === "admin" || userRoles.includes("Admin");

  // Require at least admin dashboard access (admins always pass)
  if (!isAdmin && !userFeatures.includes(FEATURES.ADMIN_DASHBOARD)) {
    redirect("/access-pending");
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <AdminSidebar userFeatures={userFeatures} />

      {/* Main content */}
      <div className="flex-1 lg:pl-64">
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
