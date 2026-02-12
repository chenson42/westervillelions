export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-lions-red text-white py-16">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-bold mb-4">Contact Us</h1>
          <p className="text-xl">We'd love to hear from you</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-3xl font-bold mb-6 text-gray-900">Get In Touch</h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-red">Email</h3>
                  <p className="text-lg text-gray-700">
                    <a href="mailto:info@westervillelions.org" className="hover:underline">
                      info@westervillelions.org
                    </a>
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-red">Meetings</h3>
                  <p className="text-lg text-gray-700">
                    1st and 3rd Wednesday of each month
                    <br />
                    6:30 PM
                    <br />
                    Westerville Community Center
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-red">Location</h3>
                  <p className="text-lg text-gray-700">
                    Westerville, Ohio
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-2 text-lions-red">Social Media</h3>
                  <p className="text-lg text-gray-700">
                    Follow us on Facebook for updates on our events and service projects
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div className="bg-gray-50 p-8 rounded-lg">
                <h3 className="text-2xl font-bold mb-6 text-gray-900">Send Us a Message</h3>
                <form className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-red focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-red focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      id="subject"
                      name="subject"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-red focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                      Message
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      rows={6}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-lions-red focus:border-transparent"
                      required
                    ></textarea>
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-lions-red text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-red-dark transition"
                  >
                    Send Message
                  </button>
                  <p className="text-sm text-gray-600 text-center">
                    (Note: This is a prototype - form submission not yet active)
                  </p>
                </form>
              </div>
            </div>
          </div>

          <div className="mt-12 bg-lions-gold/10 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Interested in Joining?</h2>
            <p className="text-lg text-gray-700 mb-4">
              We welcome new members who share our commitment to community service.
              Visitors are welcome at any of our meetings - no appointment necessary!
            </p>
            <p className="text-lg text-gray-700">
              Contact us to learn more about membership, or simply show up to a meeting
              and introduce yourself.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
