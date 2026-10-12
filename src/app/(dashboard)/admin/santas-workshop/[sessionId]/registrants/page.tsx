import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { getSessionOverview, listRegistrants } from "@/lib/santas-workshop/session-queries";
import { REGISTRANT_FLAGS, STUFFY_STATES } from "@/lib/santas-workshop/admin-contract";
import { FLAG_LABELS, STATE_LABELS, parseRegistrantFilters, registrantsHref } from "@/lib/santas-workshop/admin-ui";
import { SessionNav } from "@/components/admin/santas-workshop/session-nav";
import { RegistrantsTable } from "@/components/admin/santas-workshop/registrants-table";
import { BTN_PRIMARY, BTN_SMALL, CARD, EMPTY, INPUT, LABEL, LINK } from "@/components/admin/santas-workshop/styles";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SantasWorkshopRegistrantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  const sp = await searchParams;
  const filters = parseRegistrantFilters({ state: first(sp.state), flag: first(sp.flag), q: first(sp.q), page: first(sp.page) });

  const [s, list] = await Promise.all([
    getSessionOverview(sessionId),
    listRegistrants(sessionId, { state: filters.state || undefined, flag: filters.flag || undefined, q: filters.q || undefined, page: filters.page }),
  ]);
  if (!s || !list) notFound();

  const filtered = Boolean(filters.state || filters.flag || filters.q);
  const from = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);
  const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div className="space-y-6">
      <SessionNav session={s} active="registrants" />

      <form method="get" className={`${CARD} p-4 grid gap-4 md:grid-cols-[1fr_12rem_12rem_auto] md:items-end`} role="search">
        <div>
          <label htmlFor="rq" className={LABEL}>Search name, parent or email</label>
          <input id="rq" name="q" type="search" defaultValue={filters.q} maxLength={100} className={INPUT} />
        </div>
        <div>
          <label htmlFor="rstate" className={LABEL}>Stage</label>
          <select id="rstate" name="state" defaultValue={filters.state} className={INPUT}>
            <option value="">Any stage</option>
            {STUFFY_STATES.map((st) => (<option key={st} value={st}>{STATE_LABELS[st]}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="rflag" className={LABEL}>Show</label>
          <select id="rflag" name="flag" defaultValue={filters.flag} className={INPUT}>
            <option value="">Everyone</option>
            {REGISTRANT_FLAGS.map((f) => (<option key={f} value={f}>{FLAG_LABELS[f]}</option>))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={BTN_PRIMARY}>Apply</button>
          {filtered && <Link href={registrantsHref(s.id, {})} className={BTN_SMALL}>Clear</Link>}
        </div>
      </form>

      {list.total === 0 ? (
        <div className={EMPTY}>
          {filtered ? (
            <>
              <p className="font-medium">No one matches those filters.</p>
              <p className="mt-1 text-sm">Try a different search, or <Link href={registrantsHref(s.id, {})} className={LINK}>clear the filters</Link>.</p>
            </>
          ) : (
            <>
              <p className="font-medium">No registrants yet.</p>
              <p className="mt-1 text-sm">
                Registrations appear here as tickets are bought. First <Link href={`/admin/santas-workshop/${s.id}/connect`} className={LINK}>connect the Zeffy form</Link>.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600" role="status">
            Showing {from} to {to} of {list.total}. This list is read-only; parent contact details are visible to club admins only.
          </p>
          <RegistrantsTable registrants={list.registrants} />
          {lastPage > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-4">
              {list.page > 1 ? (
                <Link href={registrantsHref(s.id, { ...filters, page: list.page - 1 })} className={BTN_SMALL}>&larr; Previous</Link>
              ) : (<span />)}
              <span className="text-sm text-gray-600">Page {list.page} of {lastPage}</span>
              {list.page < lastPage ? (
                <Link href={registrantsHref(s.id, { ...filters, page: list.page + 1 })} className={BTN_SMALL}>Next &rarr;</Link>
              ) : (<span />)}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
