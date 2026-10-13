import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { getSessionOverview } from "@/lib/santas-workshop/session-queries";
import { STUFFY_STATES } from "@/lib/santas-workshop/admin-contract";
import { CHECKLIST_MARK, STATE_LABELS, formatEasternInstant, registrantsHref } from "@/lib/santas-workshop/admin-ui";
import { getStorageStatus } from "@/lib/santas-workshop/storage-status";
import { ADMIN_API } from "@/lib/santas-workshop/admin-ui";
import { ScheduleCard } from "@/components/admin/santas-workshop/schedule-card";
import { StatusControls } from "@/components/admin/santas-workshop/status-controls";
import { StorageCard } from "@/components/admin/santas-workshop/storage-card";
import { WorkerCodeCard } from "@/components/admin/santas-workshop/worker-code-card";
import { SessionNav } from "@/components/admin/santas-workshop/session-nav";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "@/components/admin/santas-workshop/styles";

export const dynamic = "force-dynamic";

export default async function SantasWorkshopSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  const [s, storage] = await Promise.all([getSessionOverview(sessionId), getStorageStatus()]);
  if (!s) notFound();

  const base = `/admin/santas-workshop/${s.id}`;
  const open = s.checklist.filter((c) => c.state === "todo" || c.state === "warn").length;
  const noWindow = s.counts.byWindow.find((w) => w.windowId === null);
  const awaitingPickup = s.counts.byState.checked_in + s.counts.byState.portrait_taken;

  return (
    <div className="space-y-6">
      <SessionNav session={s} active="overview" />

      <div className="grid gap-4 md:grid-cols-2">
        <StatusControls sessionId={s.id} status={s.status} kind={s.kind} />
        <WorkerCodeCard sessionId={s.id} slug={s.slug} status={s.status} access={s.workerAccess} />
      </div>

      <section className={`${CARD} p-6`} aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" className="text-lg font-semibold text-gray-900">Go-live checklist</h2>
        <p className="mt-1 text-sm text-gray-600">
          {open === 0 ? "Everything needed so far is in place." : `${open} item${open === 1 ? "" : "s"} still need${open === 1 ? "s" : ""} a look.`}
        </p>
        <ul className="mt-4 divide-y divide-gray-100">
          {s.checklist.map((c) => {
            const mark = CHECKLIST_MARK[c.state];
            return (
              <li key={c.key} className="flex items-start gap-3 py-3">
                <span aria-hidden="true" className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${mark.tone}`}>{mark.symbol}</span>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {c.label} <span className="sr-only">: {mark.srText}</span>
                  </p>
                  {c.detail && <p className="text-sm text-gray-600 break-words">{c.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`${base}/connect`} className={BTN_PRIMARY}>Connect to Zeffy</Link>
          <Link href={`${base}/registrants`} className={BTN_SECONDARY}>See registrants</Link>
          <Link href={`${base}/photos`} className={BTN_SECONDARY}>Review photos</Link>
          <Link href={`${base}/frames`} className={BTN_SECONDARY}>Make frames</Link>
          <Link href={`${base}/edit`} className={BTN_SECONDARY}>Edit session</Link>
        </div>
      </section>

      <section aria-labelledby="counts-heading" className="space-y-4">
        <h2 id="counts-heading" className="text-lg font-semibold text-gray-900">Registrations</h2>
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className={`${CARD} p-4`}>
            <dt className="text-sm text-gray-500">Stuffies</dt>
            <dd className="text-3xl font-bold text-gray-900">{s.counts.stuffies}</dd>
            <dd className="text-sm text-gray-500">{s.counts.orders} order{s.counts.orders === 1 ? "" : "s"}</dd>
          </div>
          <Link href={registrantsHref(s.id, { flag: "attention" })} className={`${CARD} p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue hover:shadow-md transition`}>
            <dt className="text-sm text-gray-500">Need attention</dt>
            <dd className={`text-3xl font-bold ${s.needsAttention > 0 ? "text-amber-700" : "text-gray-900"}`}>{s.needsAttention}</dd>
            <dd className="text-sm text-lions-blue">Review them</dd>
          </Link>
          <Link href={registrantsHref(s.id, { flag: "refund" })} className={`${CARD} p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue hover:shadow-md transition`}>
            <dt className="text-sm text-gray-500">Open refunds</dt>
            <dd className={`text-3xl font-bold ${s.refundsOpen > 0 ? "text-red-700" : "text-gray-900"}`}>{s.refundsOpen}</dd>
            <dd className="text-sm text-lions-blue">Review them</dd>
          </Link>
          <Link href={registrantsHref(s.id, { flag: "withdrawn" })} className={`${CARD} p-4 focus:outline-none focus:ring-2 focus:ring-lions-blue hover:shadow-md transition`}>
            <dt className="text-sm text-gray-500">Withdrawn</dt>
            <dd className="text-3xl font-bold text-gray-900">{s.counts.withdrawn}</dd>
            <dd className="text-sm text-lions-blue">See who</dd>
          </Link>
        </dl>

        <div className={`${CARD} flex flex-wrap items-center justify-between gap-4 p-4`}>
          <div>
            <p className="text-sm text-gray-500">Waiting for pickup</p>
            <p className="text-3xl font-bold text-gray-900">{awaitingPickup}</p>
            <p className="text-sm text-gray-500">Checked in, not yet picked up.</p>
          </div>
          <a href={ADMIN_API.awaitingPickupCsv(s.id)} download className={BTN_SECONDARY}>
            Download all stuffies not yet picked up (CSV)
          </a>
        </div>

        {s.counts.stuffies === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            <p className="font-medium">No registrations yet.</p>
            <p className="mt-1 text-sm">After the Zeffy form is connected, each ticket sold appears here as a stuffy.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${CARD} p-4`}>
              <h3 className="font-semibold text-gray-900">By stage</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {STUFFY_STATES.map((st) => (
                  <li key={st} className="flex justify-between gap-2">
                    <span className="text-gray-700">{STATE_LABELS[st]}</span>
                    <span className="font-semibold text-gray-900">{s.counts.byState[st]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${CARD} p-4`}>
              <h3 className="font-semibold text-gray-900">By drop-off window</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {s.counts.byWindow.map((w) => (
                  <li key={w.windowId ?? "none"} className="flex justify-between gap-2">
                    <span className={w.windowId ? "text-gray-700" : "text-amber-800"}>{w.windowId ? w.label : "No matching window"}</span>
                    <span className="font-semibold text-gray-900">{w.count}</span>
                  </li>
                ))}
              </ul>
              {noWindow && noWindow.count > 0 && (
                <p className="mt-2 text-sm text-amber-800">Those buyers&rsquo; window answer matched none of this session&rsquo;s windows. Check the question map and the window labels.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <ScheduleCard dropoffDate={s.dropoffDate} photoDate={s.photoDate} pickupDate={s.pickupDate} windows={s.windows} />
        <StorageCard sessionId={s.id} storage={storage} kind={s.kind} />
        <div className={`${CARD} p-6`}>
          <h2 className="text-lg font-semibold text-gray-900">Zeffy</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Form</dt><dd className="font-medium text-gray-900 text-right break-words">{s.zeffy.campaignTitle ?? (s.zeffy.campaignId ? "Connected" : "Not connected")}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Last event from this form</dt><dd className="font-medium text-gray-900 text-right">{formatEasternInstant(s.lastCampaignEventAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Last Sync</dt><dd className="font-medium text-gray-900 text-right">{formatEasternInstant(s.lastSyncAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">Webhook secret</dt><dd className="font-medium text-gray-900">{s.zeffyConfig.webhookSecretSet ? "Set" : "Not set"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-gray-500">API key</dt><dd className="font-medium text-gray-900">{s.zeffyConfig.apiKeySet ? "Set" : "Not set"}</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}
