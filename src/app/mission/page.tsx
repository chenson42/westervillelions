export default function MissionPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-red text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Our Mission</h1>
          <p className="text-xl max-w-3xl">
            To create and foster a spirit of understanding among all people for
            humanitarian needs by providing voluntary services through community involvement
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Core Principles</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-red">
                  Understanding
                </h3>
                <p className="text-gray-700">
                  Promoting understanding among the peoples of the world
                </p>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-red">
                  Good Government
                </h3>
                <p className="text-gray-700">
                  Supporting the principles of good government and good citizenship
                </p>
              </div>
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-xl font-semibold mb-3 text-lions-red">
                  Community Welfare
                </h3>
                <p className="text-gray-700">
                  Taking an active interest in the civic, cultural, social and moral welfare of the community
                </p>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-3xl font-bold mb-6 text-gray-900">Service Areas</h2>

            <div className="space-y-8">
              <div>
                <h3 className="text-2xl font-semibold mb-3 text-lions-red">Youth Programs</h3>
                <p className="text-lg text-gray-700">
                  We invest in our community's future by supporting educational programs,
                  providing scholarships, and creating opportunities for youth to develop
                  leadership skills and civic engagement.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold mb-3 text-lions-red">Community Service</h3>
                <p className="text-lg text-gray-700">
                  From local food drives to community clean-up events, we partner with
                  organizations throughout Westerville to address pressing community needs
                  and improve quality of life for all residents.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold mb-3 text-lions-red">Humanitarian Aid</h3>
                <p className="text-lg text-gray-700">
                  When disaster strikes or communities face hardship, we mobilize to provide
                  relief and support. Our efforts extend locally and globally through
                  partnerships with Lions Clubs International.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold mb-3 text-lions-red">Vision Care</h3>
                <p className="text-lg text-gray-700">
                  Following Lions International's legacy of fighting blindness, we support
                  vision screening programs and eyeglass collection drives, ensuring access
                  to vision care for those in need.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold mb-3 text-lions-red">Hunger Relief</h3>
                <p className="text-lg text-gray-700">
                  We partner with local food banks and meal programs to fight hunger in
                  our community, ensuring no family goes without nutritious food.
                </p>
              </div>

              <div>
                <h3 className="text-2xl font-semibold mb-3 text-lions-red">Environment</h3>
                <p className="text-lg text-gray-700">
                  Through conservation efforts and environmental education, we work to
                  protect our natural resources for future generations.
                </p>
              </div>
            </div>
          </section>

          <section className="bg-lions-gold/10 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Our Commitment</h2>
            <p className="text-lg text-gray-700">
              The Westerville Lions Club is committed to making a positive impact in our
              community through hands-on service, financial support, and advocacy. We believe
              that by working together, we can address our community's most pressing needs
              and create lasting change.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
