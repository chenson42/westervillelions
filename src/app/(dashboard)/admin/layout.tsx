import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessAdminArea } from "@/lib/permissions";
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

  // Require at least one admin-area feature (admins always pass). Uses the
  // same rule as the header's Admin link and AdminSidebar's visible sections
  // — see canAccessAdminArea in src/lib/permissions.ts. A user who holds a
  // narrower grant (e.g. budget.edit, without admin.dashboard) is admitted
  // here but is not entitled to the /admin stats page itself — that page has
  // its own ADMIN_DASHBOARD check and redirects onward.
  if (!isAdmin && !canAccessAdminArea(userFeatures)) {
    redirect("/access-pending");
  }

  return (
    <div className="flex min-h-screen bg-gray-50 print:bg-white">
      {/* Sidebar — hidden entirely when printing (e.g. the budget worksheet) */}
      <div className="print:hidden">
        <AdminSidebar userFeatures={userFeatures} isAdmin={isAdmin} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 lg:pl-64 print:pl-0">
        <main className="p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
