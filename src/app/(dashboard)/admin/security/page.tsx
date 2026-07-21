import { db } from "@/lib/db";
import { failedLoginAttempts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { desc, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import {
  FAILED_LOGIN_REASON_LABELS,
  type FailedLoginReason,
} from "@/lib/auth/failed-login";

/**
 * Admin Security Page — failed sign-in attempt visibility.
 *
 * Server Component, searchParams-driven (no client component, no API route —
 * matches /admin/sync-log and /admin/email-queue's zero-client-JS pattern).
 * Gated on FEATURES.ADMIN_SECURITY_VIEW following email-queue/page.tsx's
 * gating pattern exactly (auth() + hasFeature(session.user.id, ...) from
 * permissions-server, redirect to /admin on insufficient permission).
 *
 * Two views, both searchParam-driven:
 * - "list" (default): reverse-chronological attempts, searchable by attempted
 *   email, paginated (PAGE_SIZE = 25).
 * - "grouped": failures grouped by attempted email with a count and
 *   last-attempt time, always a complete summary (not scoped by the list's
 *   email search filter), capped at GROUPED_LIMIT rows.
 *
 * See docs/work-log/2026-07-21-failed-login-visibility.md (Phase 3 design
 * doc) for the full contract.
 */

const PAGE_SIZE = 25;
const GROUPED_LIMIT = 200;

type View = "list" | "grouped";

const PROVIDER_LABELS: Record<string, string> = {
  credentials: "Password",
  google: "Google",
};

function formatDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LoadErrorCard() {
  return (
    <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
      <svg
        className="mx-auto h-10 w-10 text-gray-300 mb-3"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
        />
      </svg>
      <p className="text-lg font-semibold text-gray-700">
        Couldn&rsquo;t load security data
      </p>
      <p className="mt-1 text-sm">
        Something went wrong loading failed login attempts. Please try again.
      </p>
      <Link
        href="/admin/security"
        className="mt-4 inline-block text-lions-blue hover:underline text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
      >
        Try again
      </Link>
    </div>
  );
}

export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; page?: string; view?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const canView = await hasFeature(session.user.id, FEATURES.ADMIN_SECURITY_VIEW);
  if (!canView) redirect("/admin");

  const {
    email: emailParam,
    page: pageParam = "1",
    view: viewParam,
  } = await searchParams;
  const view: View = viewParam === "grouped" ? "grouped" : "list";
  const email = (emailParam ?? "").trim();
  const page = Math.max(1, parseInt(pageParam, 10) || 1);

  function buildUrl(overrides: { view?: View; page?: number } = {}) {
    const nextView = overrides.view ?? view;
    const nextPage = overrides.page ?? 1;
    const params = new URLSearchParams();
    if (nextView !== "list") params.set("view", nextView);
    if (email) params.set("email", email);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return `/admin/security${qs ? `?${qs}` : ""}`;
  }

  const condition = email
    ? ilike(failedLoginAttempts.attemptedEmail, `%${email}%`)
    : undefined;

  let rows: {
    id: string;
    attemptedEmail: string;
    provider: string;
    reason: string;
    createdAt: Date;
  }[] = [];
  let totalCount = 0;
  let grouped: { attemptedEmail: string; attempts: number; lastAttemptAt: Date }[] = [];
  let loadError = false;

  try {
    const [listRows, countRows, groupedRows] = await Promise.all([
      db
        .select({
          id: failedLoginAttempts.id,
          attemptedEmail: failedLoginAttempts.attemptedEmail,
          provider: failedLoginAttempts.provider,
          reason: failedLoginAttempts.reason,
          createdAt: failedLoginAttempts.createdAt,
        })
        .from(failedLoginAttempts)
        .where(condition)
        .orderBy(desc(failedLoginAttempts.createdAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(failedLoginAttempts)
        .where(condition),
      // Grouped summary is always complete — intentionally NOT scoped by the
      // `email` search filter above (locked user decision: list search and
      // grouped view are two independent v1 requirements).
      db
        .select({
          attemptedEmail: failedLoginAttempts.attemptedEmail,
          attempts: sql<number>`count(*)::int`,
          lastAttemptAt: sql<Date>`max(${failedLoginAttempts.createdAt})`,
        })
        .from(failedLoginAttempts)
        .groupBy(failedLoginAttempts.attemptedEmail)
        .orderBy(sql`count(*) desc`, sql`max(${failedLoginAttempts.createdAt}) desc`)
        .limit(GROUPED_LIMIT),
    ]);
    rows = listRows;
    totalCount = countRows[0]?.count ?? 0;
    grouped = groupedRows;
  } catch {
    loadError = true;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Security</h1>
        <p className="mt-2 text-gray-600">
          Failed sign-in attempts against member and admin accounts
        </p>
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={buildUrl({ view: "list" })}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            view === "list"
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Attempt Log
        </Link>
        <Link
          href={buildUrl({ view: "grouped" })}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-lions-blue ${
            view === "grouped"
              ? "bg-lions-blue text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          By Email
        </Link>
      </div>

      {loadError ? (
        <LoadErrorCard />
      ) : view === "list" ? (
        <>
          {/* Search */}
          <form method="GET" className="flex flex-wrap gap-3">
            <input type="hidden" name="view" value="list" />
            <label htmlFor="security-email-search" className="sr-only">
              Search by attempted email
            </label>
            <input
              id="security-email-search"
              type="text"
              name="email"
              defaultValue={email}
              placeholder="Search by attempted email..."
              className="min-w-[220px] flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
            />
            <button
              type="submit"
              className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              Search
            </button>
            {email && (
              <Link
                href="/admin/security"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                Clear
              </Link>
            )}
          </form>

          {rows.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
              {email ? (
                <>No failed login attempts found for &ldquo;{email}&rdquo;.</>
              ) : (
                <>No failed login attempts recorded.</>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Timestamp
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Attempted Email
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Provider
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Reason
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white">
                      {rows.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {formatDate(r.createdAt)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 font-medium break-all">
                            {r.attemptedEmail}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                            {PROVIDER_LABELS[r.provider] ?? r.provider}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {FAILED_LOGIN_REASON_LABELS[r.reason as FailedLoginReason] ??
                              r.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-gray-700">
                <p>
                  Showing {(page - 1) * PAGE_SIZE + 1}–
                  {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                </p>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={buildUrl({ page: page - 1 })}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                    >
                      Previous
                    </Link>
                  )}
                  {page < totalPages && (
                    <Link
                      href={buildUrl({ page: page + 1 })}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-lions-blue"
                    >
                      Next
                    </Link>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      ) : grouped.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
          No failed login attempts recorded.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Attempted Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Failures
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Last Attempt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {grouped.map((g) => (
                    <tr key={g.attemptedEmail} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium break-all">
                        {g.attemptedEmail}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-gray-700">
                        {g.attempts}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(g.lastAttemptAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Showing{" "}
            {grouped.length === GROUPED_LIMIT
              ? `the top ${GROUPED_LIMIT}`
              : `all ${grouped.length}`}{" "}
            email address{grouped.length === 1 ? "" : "es"} by failure count.
          </p>
        </>
      )}
    </div>
  );
}
