import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, members, events, campaigns } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * Admin Dashboard
 *
 * Overview of system statistics and recent activity.
 */
export default async function AdminDashboardPage() {
  const session = await auth();

  // Fetch statistics
  const stats = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db.select({ count: sql<number>`count(*)::int` }).from(members),
    db.select({ count: sql<number>`count(*)::int` }).from(events),
    db.select({ count: sql<number>`count(*)::int` }).from(campaigns),
  ]);

  const [usersCount, membersCount, eventsCount, campaignsCount] = stats.map(
    (s) => s[0]?.count || 0
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Welcome back, {session?.user?.name || session?.user?.email}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={usersCount}
          icon="👥"
          description="Registered accounts"
        />
        <StatCard
          title="Active Members"
          value={membersCount}
          icon="🦁"
          description="Club members"
        />
        <StatCard
          title="Events"
          value={eventsCount}
          icon="📅"
          description="Scheduled events"
        />
        <StatCard
          title="Campaigns"
          value={campaignsCount}
          icon="💰"
          description="Active campaigns"
        />
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

      {/* System info */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">System Information</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Your Role:</dt>
            <dd className="font-medium text-gray-900">
              {session?.user?.roles?.[0] || "None"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-600">Permissions:</dt>
            <dd className="font-medium text-gray-900">
              {session?.user?.features?.length || 0} features
            </dd>
          </div>
          {session?.user?.memberId && (
            <div className="flex justify-between">
              <dt className="text-gray-600">Member ID:</dt>
              <dd className="font-medium text-gray-900">
                {session.user.memberId.substring(0, 8)}...
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: number;
  icon: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-xs text-gray-500">{description}</p>
        </div>
        <div className="text-4xl">{icon}</div>
      </div>
    </div>
  );
}

function QuickActionButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-red focus:ring-offset-2"
    >
      {label}
    </a>
  );
}
