import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { members, events, campaigns, contactSubmissions, membershipApplications, newsletterSubscriptions } from "@/lib/db/schema";
import { sql, gte, eq } from "drizzle-orm";
import Link from "next/link";

/**
 * Admin Dashboard
 *
 * Overview of system statistics and recent activity.
 */
export default async function AdminDashboardPage() {
  const session = await auth();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch statistics
  const [
    membersResult,
    upcomingEventsResult,
    campaignsResult,
    unreadContactsResult,
    pendingApplicationsResult,
    recentNewsletterResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(members).where(eq(members.isActive, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(events).where(gte(events.startDate, today)),
    db.select({ count: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.isActive, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(contactSubmissions).where(eq(contactSubmissions.isRead, false)),
    db.select({ count: sql<number>`count(*)::int` }).from(membershipApplications).where(eq(membershipApplications.status, "pending")),
    db.select({ count: sql<number>`count(*)::int` }).from(newsletterSubscriptions).where(eq(newsletterSubscriptions.isActive, true)),
  ]);

  const membersCount = membersResult[0]?.count || 0;
  const upcomingEventsCount = upcomingEventsResult[0]?.count || 0;
  const campaignsCount = campaignsResult[0]?.count || 0;
  const unreadContacts = unreadContactsResult[0]?.count || 0;
  const pendingApplications = pendingApplicationsResult[0]?.count || 0;
  const newsletterCount = recentNewsletterResult[0]?.count || 0;

  const needsAttention = unreadContacts > 0 || pendingApplications > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Welcome back, {session?.user?.name || session?.user?.email}
        </p>
      </div>

      {/* Needs Attention */}
      {needsAttention && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-800 mb-3">Needs Attention</h2>
          <div className="flex flex-wrap gap-3">
            {pendingApplications > 0 && (
              <Link
                href="/admin/applications"
                className="flex items-center gap-2 rounded-md bg-white border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 transition-colors"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                  {pendingApplications}
                </span>
                Pending Member Application{pendingApplications !== 1 ? "s" : ""}
              </Link>
            )}
            {unreadContacts > 0 && (
              <Link
                href="/admin/contacts"
                className="flex items-center gap-2 rounded-md bg-white border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 transition-colors"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                  {unreadContacts}
                </span>
                Unread Contact Message{unreadContacts !== 1 ? "s" : ""}
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          title="Active Members"
          value={membersCount}
          icon="🦁"
          description="Club members"
          href="/admin/members"
        />
        <StatCard
          title="Upcoming Events"
          value={upcomingEventsCount}
          icon="📅"
          description="Today and future"
          href="/admin/events"
        />
        <StatCard
          title="Active Campaigns"
          value={campaignsCount}
          icon="💰"
          description="Live donation campaigns"
          href="/admin/campaigns"
        />
      </div>

      {/* Newsletter stat */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📧</span>
          <div>
            <p className="text-sm font-medium text-gray-700">Newsletter Subscribers</p>
            <p className="text-xs text-gray-500">{newsletterCount} active subscription{newsletterCount !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <Link href="/admin/newsletter" className="text-sm text-lions-blue hover:text-lions-blue-dark font-medium">
          Export →
        </Link>
      </div>

      {/* Quick actions */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">Quick Actions</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QuickActionButton href="/admin/members/new" label="Add Member" />
          <QuickActionButton href="/admin/events/new" label="Create Event" />
          <QuickActionButton href="/admin/campaigns/new" label="New Campaign" />
          <QuickActionButton href="/admin/users" label="Manage Users" />
          <QuickActionButton href="/admin/groups" label="Manage Groups" />
          <QuickActionButton href="/admin/permissions" label="Permissions" />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  description,
  href,
}: {
  title: string;
  value: number;
  icon: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border border-gray-200 bg-white p-6 hover:border-lions-blue transition-colors">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        </div>
        <div className="text-4xl">{icon}</div>
      </div>
    </Link>
  );
}

function QuickActionButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
    >
      {label}
    </a>
  );
}
