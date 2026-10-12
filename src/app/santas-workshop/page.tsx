import type { Metadata } from "next";
import { workshopCopy } from "@/components/santas-workshop/copy";
import { isSupplied } from "@/components/santas-workshop/art-slots";
import { WorkshopPage } from "@/components/santas-workshop/workshop-page";
import { WORKSHOP_2026 } from "@/lib/santas-workshop/facts";
import { workshopNow } from "@/lib/santas-workshop/clock";
import { getPublicWorkshopFacts } from "@/lib/santas-workshop/public-facts";
import { workshopState } from "@/lib/santas-workshop/state";

// Static page, no database. The state is a pure function of the Eastern date.
export const revalidate = 300;

const SITE = "https://westervillelions.org";
const meta = workshopCopy(WORKSHOP_2026).meta;
const OG_IMAGE = isSupplied("og") ? `${SITE}/images/santas-workshop/og.jpg` : `${SITE}/images/og-default.jpg`;

// A static object, not a function of the request, so it cannot depend on the state; a
// crawler's cached card must not go stale when sign-ups open or close.
export const metadata: Metadata = {
  // The root layout's title template appends the club name.
  title: meta.title,
  description: meta.description,
  alternates: { canonical: `${SITE}/santas-workshop` },
  openGraph: {
    title: meta.ogTitle,
    description: meta.description,
    url: `${SITE}/santas-workshop`,
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: meta.ogTitle,
    description: meta.description,
    images: [OG_IMAGE],
  },
};

export default async function SantasWorkshopPage() {
  const facts = await getPublicWorkshopFacts();
  const now = workshopNow(process.env, new Date());
  return <WorkshopPage state={workshopState(now, facts)} facts={facts} now={now} />;
}
