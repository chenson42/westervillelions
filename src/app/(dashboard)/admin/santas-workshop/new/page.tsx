import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { easternDateString } from "@/lib/eastern-date";
import { defaultSessionDraft } from "@/lib/santas-workshop/session-input";
import { cloneDraft } from "@/lib/santas-workshop/session-clone";
import { getCloneSource } from "@/lib/santas-workshop/session-queries";
import { SessionForm } from "@/components/admin/santas-workshop/session-form";
import { CARD, LINK } from "@/components/admin/santas-workshop/styles";

export const dynamic = "force-dynamic";

export default async function NewSantasWorkshopSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ cloneFrom?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const raw = (await searchParams).cloneFrom;
  const cloneFrom = Array.isArray(raw) ? raw[0] : raw;

  if (cloneFrom !== undefined) {
    // A clone request never falls back to a blank form: that would hide that the copy did not happen.
    const source = isUuid(cloneFrom) ? await getCloneSource(cloneFrom) : null;
    if (!source) {
      return (
        <div className="space-y-6 max-w-3xl">
          <Link href="/admin/santas-workshop" className={LINK}>&larr; All sessions</Link>
          <div className={`${CARD} p-10 text-center text-gray-600`}>
            <p className="text-lg font-semibold text-gray-900">That session no longer exists</p>
            <p className="mt-2">There is nothing to clone. Go back to the list and pick another session, or start a new one from scratch.</p>
            <p className="mt-4"><Link href="/admin/santas-workshop/new" className={LINK}>Start a new session</Link></p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <Link href={`/admin/santas-workshop/${source.id}`} className={LINK}>&larr; Back to {source.name}</Link>
          <h1 className="mt-4 text-3xl font-bold text-gray-900">Clone session</h1>
          <p className="mt-2 rounded-2xl bg-lions-blue/5 p-4 text-gray-700">
            Starting from <strong>{source.name}</strong>. Dates, drop-off windows and question mapping are copied. The Zeffy form, worker code and photos are not.
          </p>
        </div>
        <SessionForm
          draft={cloneDraft(source, "practice")}
          clone={{
            sourceId: source.id,
            sourceSlug: source.slug,
            sourceKind: source.kind,
            sourceQuotaBytes: source.storageQuotaBytes,
            today: easternDateString(new Date()),
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/admin/santas-workshop" className={LINK}>&larr; All sessions</Link>
        <h1 className="mt-4 text-3xl font-bold text-gray-900">New session</h1>
        <p className="mt-2 text-gray-600">Dates and drop-off windows start from the club&rsquo;s 2026 plan. Nothing is sent or connected until you do it on the next pages.</p>
      </div>
      <SessionForm draft={defaultSessionDraft("practice")} />
    </div>
  );
}
