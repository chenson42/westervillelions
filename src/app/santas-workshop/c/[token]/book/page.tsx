import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookPrintButton } from "@/components/santas-workshop/collage/book-print-button";
import { CONTACT_EMAIL } from "@/components/santas-workshop/copy";
import { bookAvailable, bookPages } from "@/lib/santas-workshop/book-model";
import { getCollage } from "@/lib/santas-workshop/collage-queries";
import { collagePhotoPath } from "@/lib/santas-workshop/collage-contract";
import { BOOK_COPY, COLLAGE_COPY, publicTileAlt } from "@/lib/santas-workshop/collage-ui";

// Same posture as the collage: read on every request, never indexed, no referrer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: COLLAGE_COPY.title,
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

const BOOK_CSS = `
body > header, body > footer { display: none !important; }
.sw-book-page { padding: 14mm; background: #fff; }
.sw-book-figure { break-inside: avoid; page-break-inside: avoid; }
.sw-book-frame { aspect-ratio: 4 / 3; }
@media print {
  @page { size: Letter; margin: 0; }
  html, body { background: #fff !important; }
  .sw-noprint { display: none !important; }
  .sw-book-page { break-before: page; page-break-before: always; box-decoration-break: clone; -webkit-box-decoration-break: clone; box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; }
  .sw-book-cover { break-before: auto; page-break-before: auto; min-height: 250mm; }
  .sw-book-page h1, .sw-book-page h2 { break-after: avoid; page-break-after: avoid; }
  .sw-book-grid { gap: 6mm !important; }
}
`;

export default async function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getCollage(token);
  if (!view) notFound();
  const pages = bookAvailable(view) ? bookPages(view.scenes) : [];
  if (pages.length === 0) redirect(`/santas-workshop/c/${token}`);

  return (
    <div className="min-h-screen bg-gray-100 py-6 print:bg-white print:py-0">
      <style>{BOOK_CSS}</style>
      <div className="sw-noprint mx-auto mb-6 max-w-3xl space-y-3 px-4">
        <Link
          href={`/santas-workshop/c/${token}`}
          className="text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
        >
          &larr; {BOOK_COPY.back}
        </Link>
        {view.practice && (
          <p className="rounded-lg bg-lions-gold/20 p-3 text-center text-sm font-semibold text-gray-900" role="note">
            {COLLAGE_COPY.practice}
          </p>
        )}
        <BookPrintButton />
        <p className="text-sm text-gray-700">{BOOK_COPY.desktopHint}</p>
        <p className="text-sm text-gray-700">{BOOK_COPY.iphoneHint}</p>
        <p className="text-sm text-gray-600">{BOOK_COPY.loadsAll}</p>
      </div>

      <main className="mx-auto max-w-3xl space-y-6 px-4 print:max-w-none print:space-y-0 print:px-0">
        <section className="sw-book-page sw-book-cover flex flex-col items-center justify-center rounded-2xl text-center shadow-sm" aria-labelledby="book-title">
          <p className="text-sm uppercase tracking-widest text-lions-gold">{COLLAGE_COPY.siteName}</p>
          <h1 id="book-title" className="sw-display mt-2 text-4xl font-bold text-lions-blue">
            {COLLAGE_COPY.title}
          </h1>
          <p className="mt-3 text-gray-700">{BOOK_COPY.coverLine}</p>
        </section>

        {pages.map((page, i) => (
          <section key={i} className="sw-book-page rounded-2xl shadow-sm" aria-labelledby={`book-scene-${i}-heading`}>
            <h2 id={`book-scene-${i}-heading`} className="sw-display text-2xl font-bold text-gray-900">
              {page.title}
            </h2>
            {page.caption !== null && <p className="mt-1 text-gray-700">{page.caption}</p>}
            <ul className="sw-book-grid mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="book-scene">
              {page.photoIds.map((id, j) => (
                <li key={id} className="sw-book-figure">
                  <div className="sw-book-frame flex items-center justify-center overflow-hidden rounded-lg bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by the photo door */}
                    <img
                      src={collagePhotoPath(id, "full")}
                      alt={publicTileAlt("group", page.startIndex + j)}
                      loading="eager"
                      className="h-full w-full object-contain"
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="sw-book-page rounded-2xl text-center text-sm text-gray-700 shadow-sm">
          <p className="text-base font-semibold text-gray-900">{BOOK_COPY.closing}</p>
          <p className="mt-2">{COLLAGE_COPY.stuffiesOnly}</p>
          <p className="mt-2">
            {COLLAGE_COPY.removalLead} {CONTACT_EMAIL} {COLLAGE_COPY.removalTail}
          </p>
          <p className="mt-2">{BOOK_COPY.savedCopy}</p>
        </section>
      </main>
    </div>
  );
}
