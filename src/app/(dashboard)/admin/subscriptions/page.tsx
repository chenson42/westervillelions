import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { newsletterSubscriptions } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import ExportSubscribersButton from "@/components/admin/export-subscribers-button";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const subscribers = await db
    .select()
    .from(newsletterSubscriptions)
    .orderBy(desc(newsletterSubscriptions.subscribedAt));

  const activeCount = subscribers.filter((s) => s.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Newsletter Subscribers</h1>
          <p className="mt-2 text-gray-600">
            {activeCount} active subscriber{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        <ExportSubscribersButton />
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Source
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Subscribed
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {subscribers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No subscribers yet
                </td>
              </tr>
            ) : (
              subscribers.map((sub) => (
                <tr key={sub.id} className={`hover:bg-gray-50 ${!sub.isActive ? "opacity-60" : ""}`}>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {sub.firstName || sub.lastName
                      ? `${sub.firstName ?? ""} ${sub.lastName ?? ""}`.trim()
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                    {sub.email}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {sub.source}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {sub.subscribedAt.toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                      sub.isActive
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-500"
                    }`}>
                      {sub.isActive ? "Active" : "Unsubscribed"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
