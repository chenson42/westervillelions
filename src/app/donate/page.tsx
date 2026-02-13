export default function DonatePage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Support Our Mission</h1>
          <p className="text-xl">Your donation helps us serve our community</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Make a Difference</h2>
            <p className="text-lg text-gray-700 mb-6">
              The Westerville Lions Club is a 501(c)(3) nonprofit organization. Your
              tax-deductible donation directly supports our community service programs,
              youth scholarships, humanitarian aid, and local initiatives.
            </p>
            <p className="text-lg text-gray-700">
              Every dollar you contribute stays in our community or goes to support
              Lions International's global humanitarian efforts.
            </p>
          </section>

          <section className="mb-12">
            <div className="bg-lions-gold/10 border-2 border-lions-gold p-8 rounded-lg text-center">
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                Donate Through Givebutter
              </h3>
              <p className="text-lg text-gray-700 mb-6">
                We use Givebutter for secure online donations. Your contribution is
                safe, easy, and makes an immediate impact.
              </p>
              <a
                href="https://givebutter.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-lions-blue text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-lions-blue-dark transition"
              >
                Donate Now
              </a>
              <p className="text-sm text-gray-600 mt-4">
                You'll be redirected to our secure Givebutter campaign page
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Where Your Money Goes</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-blue">
                  Youth Programs
                </h3>
                <p className="text-gray-700">
                  Scholarships, educational programs, and youth leadership development
                </p>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-blue">
                  Community Projects
                </h3>
                <p className="text-gray-700">
                  Local service initiatives, food drives, and community support programs
                </p>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-blue">
                  Humanitarian Aid
                </h3>
                <p className="text-gray-700">
                  Disaster relief, vision care, and support for those in need
                </p>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-blue">
                  Hunger Relief
                </h3>
                <p className="text-gray-700">
                  Partnerships with food banks and meal programs for families in need
                </p>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Other Ways to Give</h2>
            <div className="space-y-4 text-lg text-gray-700">
              <p>
                <strong>Mail a Check:</strong> Make checks payable to "Westerville Lions Club"
                and mail to our treasurer (contact us for mailing address)
              </p>
              <p>
                <strong>Donate Items:</strong> We accept eyeglass donations and other items
                for our service programs
              </p>
              <p>
                <strong>Volunteer Your Time:</strong> Join us at our events and service
                projects - your time is just as valuable as financial support
              </p>
            </div>
          </section>

          <section className="bg-gray-50 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Questions?</h2>
            <p className="text-lg text-gray-700 mb-4">
              Have questions about donations, our programs, or how your contribution will
              be used? We're happy to help!
            </p>
            <a
              href="/contact"
              className="inline-block bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
            >
              Contact Us
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
