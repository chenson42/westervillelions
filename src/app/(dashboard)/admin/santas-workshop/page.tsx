import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listSessions } from "@/lib/santas-workshop/session-queries";
import { getStorageStatus } from "@/lib/santas-workshop/storage-status";
import { formatLongDate } from "@/lib/santas-workshop/format";
import { relativeTime } from "@/lib/santas-workshop/admin-ui";
import { KindBadge, StatusBadge } from "@/components/admin/santas-workshop/badges";
import { BTN_PRIMARY, EMPTY } from "@/components/admin/santas-workshop/styles";

export const dynamic = "force-dynamic";

/** Sessions list. Gates on its own (the proxy rule is only the coarse outer gate). */
export default async function AdminSantasWorkshopPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const [sessions, storage] = await Promise.all([listSessions(), getStorageStatus()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Santa&rsquo;s Workshop</h1>
          <p className="mt-2 text-gray-600">Sessions for the stuffed-animal visit: connect the Zeffy form, watch registrations arrive and review who is signed up.</p>
        </div>
        <Link href="/admin/santas-workshop/new" className={BTN_PRIMARY}>New session</Link>
      </div>

      {storage.bannerCause && (
        <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-800">
          Photo storage problem: {storage.bannerCause}
        </p>
      )}

      {sessions.length === 0 ? (
        <div className={EMPTY}>
          <p className="font-medium">No sessions yet.</p>
          <p className="mt-1 text-sm">Create a practice session first to try the whole flow, then the real one.</p>
          <Link href="/admin/santas-workshop/new" className={`${BTN_PRIMARY} mt-4`}>Create the first session</Link>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/santas-workshop/${s.id}`}
                className="block h-full bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-6 focus:outline-none focus:ring-2 focus:ring-lions-blue"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900 break-words">{s.name}</h2>
                  <KindBadge kind={s.kind} />
                  <StatusBadge status={s.status} />
                </div>
                <p className="mt-1 text-sm text-gray-500">Drop-off {formatLongDate(s.dropoffDate)}</p>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-gray-500">Stuffies</dt>
                    <dd className="text-xl font-bold text-gray-900">{s.stuffyCount}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Need attention</dt>
                    <dd className={`text-xl font-bold ${s.needsAttentionCount > 0 ? "text-amber-700" : "text-gray-900"}`}>{s.needsAttentionCount}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Last Zeffy event</dt>
                    <dd className="font-medium text-gray-900">{relativeTime(s.lastZeffyEventAt)}</dd>
                  </div>
                </dl>
                {!s.zeffy.campaignId && <p className="mt-3 text-sm font-medium text-amber-800">No Zeffy form connected yet.</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
