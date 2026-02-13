export default function CampaignsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-blue text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Campaigns</h1>
          <p className="text-xl">Support our fundraising efforts</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-md mb-8">
            <h2 className="text-3xl font-bold mb-6 text-lions-blue">Support Our Work</h2>
            <p className="text-lg text-gray-700 mb-6 leading-relaxed">
              Your donations help us continue our mission of serving the Westerville community through various humanitarian projects and initiatives.
            </p>
            <a
              href="https://givebutter.com/westervillelions"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-lions-gold text-lions-blue-dark px-8 py-4 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition shadow-lg"
            >
              Donate Now
            </a>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-blue-50 rounded-xl p-6">
              <h3 className="text-xl font-bold mb-3 text-lions-blue">One-Time Donation</h3>
              <p className="text-gray-700">
                Make a single contribution to support our ongoing service projects and community programs.
              </p>
            </div>
            <div className="bg-blue-50 rounded-xl p-6">
              <h3 className="text-xl font-bold mb-3 text-lions-blue">Monthly Giving</h3>
              <p className="text-gray-700">
                Become a sustaining supporter with a monthly contribution to help us plan and expand our impact.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
