import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollageGallery } from "@/components/santas-workshop/collage/collage-gallery";
import { getCollage } from "@/lib/santas-workshop/collage-queries";
import { CONTACT_EMAIL } from "@/components/santas-workshop/copy";
import { easternDateString } from "@/lib/eastern-date";
import { workshopNow } from "@/lib/santas-workshop/clock";
import { COLLAGE_COPY, COLLAGE_REMOVAL_HREF, pendingBody, pendingHeadline } from "@/lib/santas-workshop/collage-ui";

// Read from the database on every request, so a hide or an unpublish is never held by a page cache.
// Images carry the one accepted 5-minute browser window (private, max-age=300) from the photo door.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: COLLAGE_COPY.title,
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// The collage is a quiet page of its own: no site menu, no footer, only the club name above.
const HIDE_SITE_CHROME = "body > header, body > footer { display: none !important; }";

export default async function CollagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getCollage(token);
  if (!view) notFound();

  const group = view.tiles.filter((t) => t.kind === "group");
  const portraits = view.tiles.filter((t) => t.kind === "portrait");
  const today = easternDateString(workshopNow(process.env, new Date()));

  return (
    <div className="sw-collage-root sw-snow-bg min-h-screen">
      <style>{HIDE_SITE_CHROME}</style>
      <header className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white print:bg-none print:bg-white print:text-black">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <p className="text-sm uppercase tracking-widest text-lions-gold">{COLLAGE_COPY.siteName}</p>
          <h1 className="sw-display mt-1 text-3xl font-bold sm:text-4xl">{COLLAGE_COPY.title}</h1>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8">
        {view.practice && (
          <p className="mb-6 rounded-lg bg-lions-gold/20 p-3 text-center text-sm font-semibold text-gray-900" role="note">
            {COLLAGE_COPY.practice}
          </p>
        )}

        {view.state === "pending" && (
          <section className="rounded-2xl bg-white p-8 text-center shadow-sm" aria-labelledby="state-heading">
            <h2 id="state-heading" className="sw-display text-2xl font-bold text-gray-900">
              {pendingHeadline(view.arrivesOn, today)}
            </h2>
            <p className="mt-2 text-gray-600">{pendingBody(view.arrivesOn, today)}</p>
          </section>
        )}

        {view.state === "removed" && (
          <section className="rounded-2xl bg-white p-8 text-center shadow-sm" aria-labelledby="state-heading">
            <h2 id="state-heading" className="sw-display text-2xl font-bold text-gray-900">
              {COLLAGE_COPY.removed}
            </h2>
            <p className="mt-2 text-gray-600">{COLLAGE_COPY.removedBody}</p>
          </section>
        )}

        {view.state === "live" && (
          <div className="space-y-10">
            {view.tiles.length === 0 && <div className="rounded-2xl bg-gray-50 p-10 text-center text-gray-500">{COLLAGE_COPY.emptyLive}</div>}
            {group.length > 0 && (
              <section aria-labelledby="group-heading" className="space-y-3">
                <h2 id="group-heading" className="sw-display text-2xl font-bold text-gray-900">
                  {COLLAGE_COPY.groupHeading}
                </h2>
                <CollageGallery tiles={group} kind="group" />
              </section>
            )}
            {portraits.length > 0 && (
              <section aria-labelledby="portrait-heading" className="space-y-3">
                <h2 id="portrait-heading" className="sw-display text-2xl font-bold text-gray-900">
                  {COLLAGE_COPY.portraitHeading}
                </h2>
                <CollageGallery tiles={portraits} kind="portrait" />
              </section>
            )}
          </div>
        )}

        <footer className="sw-print-footer mt-12 space-y-1 border-t border-gray-200 pt-6 text-center text-sm text-gray-600">
          <p>{COLLAGE_COPY.stuffiesOnly}</p>
          <p>
            {COLLAGE_COPY.removalLead}{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
              {CONTACT_EMAIL}
            </a>{" "}
            {COLLAGE_COPY.removalTail}{" "}
            <Link href={COLLAGE_REMOVAL_HREF} className="sw-noprint font-semibold text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
              {COLLAGE_COPY.removalLink}
            </Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
