export default function MeetingsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Meetings</h1>
          <p className="text-xl">Join us for our regular club meetings</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-md mb-8">
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">Regular Meetings</h2>
            <div className="space-y-4 text-lg text-gray-700">
              <p>
                <strong>When:</strong> Details to be announced
              </p>
              <p>
                <strong>Where:</strong> Location information available to members
              </p>
              <p>
                <strong>Format:</strong> Regular business meetings with fellowship and service planning
              </p>
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl p-8">
            <h3 className="text-2xl font-bold mb-4 text-lions-blue">Interested in Attending?</h3>
            <p className="text-lg text-gray-700 mb-6">
              Guests are welcome to attend our meetings to learn more about Lions Club and our service projects.
            </p>
            <a
              href="/contact"
              className="inline-block bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition"
            >
              Contact Us for Meeting Details
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
