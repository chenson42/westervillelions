import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessAdminArea, FEATURES } from "@/lib/permissions";
import AdminSidebar from "@/components/admin/admin-sidebar";
import { getFailedEmailCount } from "@/lib/email-queue-stats";
import { getReadyToSendReportCountCached } from "@/lib/financial-report-send";

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

  // Failed-email-count badge (docs/work-log/2026-09-25-email-silent-success.md
  // Phase 6 follow-up #1). Only queried for users who could actually open
  // /admin/email-queue — that page gates on ADMIN_USERS specifically (a
  // narrower check than "can access some admin area"), so this mirrors it
  // rather than leaking the count to an admin who can't see the page. The
  // Email Queue nav item deliberately carries no requiredFeature of its own
  // (see permissions.ts/permissions.test.ts) — this check does not add one,
  // it only decides whether to fetch and pass a number as a prop.
  const canSeeEmailQueue = isAdmin || userFeatures.includes(FEATURES.ADMIN_USERS);
  const failedEmailCount = canSeeEmailQueue ? await getFailedEmailCount() : 0;

  // Ready-to-send-reports badge (B-69, docs/work-log/2026-09-25-ready-to-send-badge.md).
  // Gated on the SAME permission the send action and the Reports page's send
  // panel require (FEATURES.LEDGER_REPORT_SEND) — narrower than LEDGER_VIEW,
  // which merely lets someone open /admin/ledger/reports read-only. The query
  // must not even run for a user who can't send, mirroring the failed-email
  // badge's gate-before-fetch shape above.
  //
  // Uses the CACHED wrapper (B-71 stopgap, financial-report-send.ts's own doc
  // comment on getReadyToSendReportCountCached()) because this call now runs
  // on every admin page render for a LEDGER_REPORT_SEND holder, and the
  // underlying walk is not cheap — see that doc comment for the full
  // reasoning and TTL justification.
  const canSeeReadyToSendCount = isAdmin || userFeatures.includes(FEATURES.LEDGER_REPORT_SEND);
  const readyToSendReportCount = canSeeReadyToSendCount ? await getReadyToSendReportCountCached() : 0;

  return (
    <div className="flex min-h-screen bg-gray-50 print:bg-white">
      {/* Sidebar — hidden entirely when printing (e.g. the budget worksheet) */}
      <div className="print:hidden">
        <AdminSidebar
          userFeatures={userFeatures}
          isAdmin={isAdmin}
          failedEmailCount={failedEmailCount}
          readyToSendReportCount={readyToSendReportCount}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 lg:pl-64 print:pl-0">
        <main className="p-6 print:p-0">{children}</main>
      </div>
    </div>
  );
}
