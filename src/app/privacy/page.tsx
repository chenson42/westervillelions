import type { Metadata } from "next";

import { getPublicWorkshopFacts } from "@/lib/santas-workshop/public-facts";
import { formatMonthDay } from "@/lib/santas-workshop/format";
import {
  COLLAGE_KEEPING,
  PHOTO_BOX_HELPER,
  PHOTO_BOX_LABEL,
  PROMISE,
} from "@/components/santas-workshop/copy";
import Link from "next/link";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How the Westerville Lions Club collects, uses, and protects the personal information visitors and members share with us.",
  alternates: {
    canonical: "https://westervillelions.org/privacy",
  },
  openGraph: {
    title: "Privacy Policy | Westerville Lions Club",
    description:
      "How the Westerville Lions Club collects, uses, and protects the personal information visitors and members share with us.",
    url: "https://westervillelions.org/privacy",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    type: "website",
  },
};

const EFFECTIVE_DATE = "October 12, 2026";

export default async function PrivacyPage() {
  const workshop = await getPublicWorkshopFacts();
  const deletedBy = `${formatMonthDay(workshop.signupDataDeletedBy)}, ${workshop.signupDataDeletedBy.slice(0, 4)}`;
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2 font-semibold">
            Your Privacy
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Privacy Policy</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            A plain-language explanation of what information we collect and how we use it.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <p className="text-gray-500 text-sm mb-10">Effective date: {EFFECTIVE_DATE}</p>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">What We Collect</h2>
            <p className="text-gray-700 mb-4">
              We only collect the information you choose to give us, through the forms and
              features on this site:
            </p>
            <ul className="space-y-3 text-gray-700 list-disc pl-5">
              <li>
                <strong>Contact form:</strong> your name, email address, and the message you send us.
              </li>
              <li>
                <strong>Newsletter sign-up:</strong> your name and email address.
              </li>
              <li>
                <strong>Membership application:</strong> your contact details, date of birth, and
                household information, collected as part of the standard Lions Clubs
                International membership application.
              </li>
              <li>
                <strong>Event RSVPs:</strong> your name and email address.
              </li>
              <li>
                <strong>Santa&apos;s Workshop sign-ups:</strong> collected for us by Zeffy: your
                name, email and mobile number, your stuffy&apos;s name and description, a snack
                preference and, if you choose to give them, a child&apos;s first name, a care note
                and a note to Santa.
              </li>
              <li>
                <strong>Member accounts:</strong> the sign-in information (email address, and
                Google account details if you sign in with Google) that lets members access the
                member portal.
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">How We Use It</h2>
            <p className="text-gray-700 mb-4">We use the information you give us to:</p>
            <ul className="space-y-2 text-gray-700 list-disc pl-5">
              <li>Respond to your message, question, or application.</li>
              <li>Administer club activities, events, and the member portal.</li>
              <li>Report membership information to Lions Clubs International, as required of every chartered Lions club.</li>
              <li>Coordinate event attendance and RSVPs.</li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">A Visit to Santa&apos;s Workshop</h2>
            <div className="space-y-3 text-gray-700">
              <p>
                We use sign-up details only to run the event: to find your stuffy, to reach you,
                and to offer a snack. Zeffy processes the payment and keeps its own record. The
                club&apos;s volunteers see your answers. We delete sign-up details from the
                club&apos;s records by {deletedBy}.
              </p>
              <p className="font-semibold">{PROMISE}</p>
              <p>
                On the sign-up form, one optional box reads: &ldquo;{PHOTO_BOX_LABEL}&rdquo;{" "}
                {PHOTO_BOX_HELPER} {COLLAGE_KEEPING}
              </p>
              <p>
                To remove a photo or a detail, contact us at{" "}
                <a href="mailto:info@westervillelions.org" className="text-lions-blue hover:underline">
                  info@westervillelions.org
                </a>{" "}
                and we will take it down.
              </p>
              <p>
                <Link href="/santas-workshop" className="text-lions-blue hover:underline">
                  Back to A Visit to Santa&apos;s Workshop
                </Link>
              </p>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">What We Don&apos;t Do</h2>
            <p className="text-gray-700">
              We do not sell or rent your personal information to anyone, for any reason, ever.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Analytics</h2>
            <p className="text-gray-700">
              This site uses Google Analytics to understand how visitors use it, via standard
              browser cookies. This helps us see which pages are useful and where visitors run
              into trouble — it doesn&apos;t identify you personally.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Email Preferences</h2>
            <p className="text-gray-700">
              You can unsubscribe from our newsletter or other club emails at any time by
              contacting{" "}
              <a href="mailto:info@westervillelions.org" className="text-lions-blue hover:underline">
                info@westervillelions.org
              </a>
              .
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Questions or Removal Requests</h2>
            <p className="text-gray-700">
              If you have questions about this policy, or would like to see, correct, or remove
              the personal information we hold about you, contact us at{" "}
              <a href="mailto:info@westervillelions.org" className="text-lions-blue hover:underline">
                info@westervillelions.org
              </a>
              .
            </p>
          </section>

          <section className="bg-gray-50 rounded-2xl p-6">
            <p className="text-sm text-gray-500">
              This policy may be updated from time to time as our site and programs change. We&apos;ll
              update the effective date above when it does.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
