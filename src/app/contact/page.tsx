import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/contact-form";
import { NewsletterForm } from "@/components/newsletter-form";

export const metadata: Metadata = {
  title: "Connect With Us",
  description:
    "Get in touch with the Westerville Lions Club. Send a message, subscribe to our newsletter, or stop by one of our meetings in Westerville, Ohio.",
};

const breadcrumb = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://westervillelions.org" },
    { "@type": "ListItem", position: 2, name: "Connect", item: "https://westervillelions.org/contact" },
  ],
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="bg-lions-blue text-white py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-lions-gold font-semibold uppercase tracking-widest text-sm mb-4">
            Connect
          </p>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">Connect With Us</h1>
          <p className="text-xl md:text-2xl text-blue-100 max-w-2xl leading-relaxed">
            We&apos;d love to hear from you — reach out, subscribe to our newsletter, or stop by a meeting.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-16">

          {/* Contact info + form */}
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-3xl font-bold mb-6 text-gray-900">Get In Touch</h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-blue">Email</h3>
                  <p className="text-lg text-gray-700">
                    <a href="mailto:info@westervillelions.org" className="hover:underline">
                      info@westervillelions.org
                    </a>
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-blue">Meeting Location</h3>
                  <p className="text-lg text-gray-700 mb-3">
                    The Landings
                    <br />
                    350 County Line Rd W
                    <br />
                    Westerville, OH 43082
                  </p>
                  <div className="rounded-lg overflow-hidden border border-gray-200">
                    <iframe
                      title="Meeting location map"
                      src="https://maps.google.com/maps?q=The+Landings+350+County+Line+Rd+W+Westerville+OH+43082&output=embed&z=15"
                      width="100%"
                      height="220"
                      style={{ border: 0 }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-blue">Mailing Address</h3>
                  <p className="text-lg text-gray-700">
                    PO Box 0597
                    <br />
                    Westerville, OH 43086-0597
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-blue">Follow Us</h3>
                  <p className="text-lg text-gray-700 mb-3">
                    Stay up to date on social media
                  </p>
                  <div className="flex gap-4">
                    <a
                      href="https://www.facebook.com/WestervilleLions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lions-blue hover:text-lions-blue-dark transition"
                      aria-label="Facebook"
                    >
                      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    </a>
                    <a
                      href="https://x.com/LionWesterville"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lions-blue hover:text-lions-blue-dark transition"
                      aria-label="X (Twitter)"
                    >
                      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                      </svg>
                    </a>
                    <a
                      href="https://www.instagram.com/westervillelions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lions-blue hover:text-lions-blue-dark transition"
                      aria-label="Instagram"
                    >
                      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/>
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-4 text-gray-900">Send a Message</h2>
              <ContactForm />
            </div>
          </div>

          {/* Newsletter signup */}
          <div id="newsletter" className="rounded-xl border border-lions-blue/20 bg-lions-blue/5 p-8">
            <div className="max-w-xl">
              <h2 className="text-2xl font-bold mb-2 text-gray-900">Be Part of Something Bigger</h2>
              <p className="text-gray-600 mb-6">
                Get monthly updates on service projects, community events, and membership opportunities — delivered straight to your inbox. No spam, just Lions.
              </p>
              <NewsletterForm />
            </div>
          </div>

          {/* Join CTA */}
          <div className="bg-lions-gold/10 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Interested in Joining?</h2>
            <p className="text-lg text-gray-700 mb-4">
              We welcome new members who share our commitment to community service.
              Visitors are welcome at any of our meetings — no appointment necessary!
            </p>
            <p className="text-lg text-gray-700 mb-6">
              Ready to become a Lion? Submit a membership application and a club representative will be in touch.
            </p>
            <Link
              href="/join"
              className="inline-block bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
            >
              Apply for Membership
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
