export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="bg-lions-red text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold mb-4">Westerville Lions Club</h1>
          <p className="text-2xl mb-8">
            Serving Our Community Since 1938
          </p>
          <p className="text-xl max-w-3xl mx-auto">
            Creating and fostering a spirit of understanding among all people
            for humanitarian needs by providing voluntary services through
            community involvement.
          </p>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12 text-gray-900">
            Our Mission
          </h2>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-3 text-lions-red">
                Youth Programs
              </h3>
              <p className="text-gray-700">
                Supporting education, scholarships, and youth activities in our
                community
              </p>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-3 text-lions-red">
                Community Service
              </h3>
              <p className="text-gray-700">
                Partnering with local organizations to address community needs
              </p>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold mb-3 text-lions-red">
                Humanitarian Aid
              </h3>
              <p className="text-gray-700">
                Providing disaster relief and support to those in need
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8 text-gray-900">
            Get Involved
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/donate"
              className="bg-lions-red text-white px-8 py-3 rounded-lg font-semibold hover:bg-lions-red-dark transition"
            >
              Donate
            </a>
            <a
              href="/contact"
              className="bg-gray-200 text-gray-900 px-8 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
