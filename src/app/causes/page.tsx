export default function CausesPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Our Causes</h1>
          <p className="text-xl">Making a difference in our community and beyond</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-12">
          <section>
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">Vision Services</h2>
            <p className="text-lg text-gray-700 leading-relaxed mb-4">
              Supporting vision health through eye screenings, glasses recycling programs, and access to eye care services for those in need.
            </p>
          </section>

          <section>
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">Community Support</h2>
            <p className="text-lg text-gray-700 leading-relaxed mb-4">
              Providing assistance to local families and individuals through food drives, holiday programs, and emergency relief efforts.
            </p>
          </section>

          <section>
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">Youth Programs</h2>
            <p className="text-lg text-gray-700 leading-relaxed mb-4">
              Empowering the next generation through scholarships, educational programs, and youth leadership development.
            </p>
          </section>

          <section>
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">International Service</h2>
            <p className="text-lg text-gray-700 leading-relaxed mb-4">
              Supporting global humanitarian efforts and disaster relief through Lions Clubs International Foundation.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
