import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import RetryButton from "./retry-button";

export default async function AdminEmailQueuePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // Admin-only page
  const isAdmin =
    session.user.roles?.includes("admin") || session.user.role === "admin";
  if (!isAdmin) redirect("/admin");

  const [failed, recentSent] = await Promise.all([
    db
      .select()
      .from(emailQueue)
      .where(eq(emailQueue.status, "failed"))
      .orderBy(desc(emailQueue.createdAt))
      .limit(100),
    db
      .select()
      .from(emailQueue)
      .where(eq(emailQueue.status, "sent"))
      .orderBy(desc(emailQueue.sentAt))
      .limit(20),
  ]);

  function formatDate(d: Date | null) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Email Queue</h1>
          <p className="mt-2 text-gray-600">
            Monitor outbound email delivery and retry failed messages
          </p>
        </div>
        <RetryButton />
      </div>

      {/* Failed emails */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Failed Emails
          {failed.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              {failed.length}
            </span>
          )}
        </h2>

        {failed.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No failed emails — everything is delivering successfully.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Attempts
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Next Retry
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Last Error
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {failed.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                      {item.to}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {item.subject}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 text-center">
                      {item.attempts}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDate(item.nextRetryAt)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-sm text-amber-700 max-w-xs">
                      <span className="line-clamp-2">{item.lastError ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>

      {/* Recent successful sends */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Recently Sent (last 20)
        </h2>

        {recentSent.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No emails sent yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Attempts
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Sent At
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {recentSent.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                      {item.to}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {item.subject}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 text-center">
                      {item.attempts}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDate(item.sentAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
