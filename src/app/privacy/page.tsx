import type { Metadata } from "next";

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

const EFFECTIVE_DATE = "September 4, 2026";

export default function PrivacyPage() {
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
