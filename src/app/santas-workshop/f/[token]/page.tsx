import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FamilyPortraitImage } from "@/components/santas-workshop/family/family-portrait";
import { FamilyPrintQr } from "@/components/santas-workshop/family/family-print-qr";
import { PrintButton } from "@/components/santas-workshop/family/print-button";
import { CONTACT_EMAIL } from "@/components/santas-workshop/copy";
import { easternDateString } from "@/lib/eastern-date";
import { workshopNow } from "@/lib/santas-workshop/clock";
import { COLLAGE_COPY, COLLAGE_REMOVAL_HREF } from "@/lib/santas-workshop/collage-ui";
import { familyPortraitPath } from "@/lib/santas-workshop/family-contract";
import { getFamilyView } from "@/lib/santas-workshop/family-queries";
import { FAMILY_COPY, FAMILY_FOOTER, familyModel } from "@/lib/santas-workshop/family-ui";

// Read on every request so a hide, a retake or a purge is never held by a page cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: FAMILY_COPY.title,
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const HIDE_SITE_CHROME = "body > header, body > footer { display: none !important; }";

export default async function FamilyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyView(token);
  if (!view) notFound();

  const today = easternDateString(workshopNow(process.env, new Date()));
  const m = familyModel(view, today);

  return (
    <div className="sw-collage-root sw-snow-bg min-h-screen">
      <style>{HIDE_SITE_CHROME}</style>
      <header className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white print:bg-none print:bg-white print:text-black">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
          <p className="text-sm uppercase tracking-widest text-lions-gold">{COLLAGE_COPY.siteName}</p>
          <h1 className="sw-display mt-1 text-3xl font-bold sm:text-4xl">{m.heading}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {m.practice && (
          <p className="mb-6 rounded-lg bg-lions-gold/20 p-3 text-center text-sm font-semibold text-gray-900" role="note">
            {FAMILY_COPY.practice}
          </p>
        )}

        {m.block.kind === "portrait" ? (
          <section className="space-y-4" aria-label="Portrait">
            <FamilyPortraitImage
              src={familyPortraitPath(token, "full", { version: m.block.version })}
              alt={`Portrait of ${m.heading}`}
            />
            <p className="sw-noprint text-center">
              <a
                href={familyPortraitPath(token, "full", { download: true, version: m.block.version })}
                className="font-semibold text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
              >
                {FAMILY_COPY.download}
              </a>
            </p>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-8 text-center shadow-sm" aria-labelledby="state-heading">
            <h2 id="state-heading" className="sw-display text-2xl font-bold text-gray-900">
              {m.block.headline}
            </h2>
            <p className="mt-2 text-gray-600">{m.block.body}</p>
          </section>
        )}

        {m.collage.kind === "link" && (
          <section className="mt-8 rounded-2xl bg-white p-6 text-center shadow-sm" aria-labelledby="collage-heading">
            <h2 id="collage-heading" className="sw-display text-xl font-bold text-gray-900">
              {FAMILY_COPY.collageLink}
            </h2>
            <p className="mt-1 text-gray-600">{FAMILY_COPY.collageLead}</p>
            <Link
              href={m.collage.path}
              className="sw-noprint mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
            >
              {FAMILY_COPY.collageLink}
            </Link>
            <FamilyPrintQr collagePath={m.collage.path} />
          </section>
        )}

        {m.collage.kind === "note" && (
          <section className="mt-8 rounded-2xl bg-white p-6 text-center shadow-sm" aria-labelledby="collage-heading">
            <h2 id="collage-heading" className="sw-display text-xl font-bold text-gray-900">
              {m.collage.headline}
            </h2>
            <p className="mt-1 text-gray-600">{m.collage.body}</p>
          </section>
        )}

        {m.block.kind === "portrait" && (
          <div className="mt-6 text-center">
            <PrintButton />
          </div>
        )}

        <footer className="sw-print-footer mt-12 space-y-1 border-t border-gray-200 pt-6 text-center text-sm text-gray-600">
          <p>{FAMILY_FOOTER.stuffiesOnly}</p>
          <p>
            {FAMILY_FOOTER.removalLead}{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
              {CONTACT_EMAIL}
            </a>{" "}
            {FAMILY_FOOTER.removalTail}{" "}
            <Link href={COLLAGE_REMOVAL_HREF} className="sw-noprint font-semibold text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded">
              {COLLAGE_COPY.removalLink}
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
