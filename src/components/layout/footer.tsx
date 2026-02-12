import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-gray-900 text-white mt-16">
      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4 text-lions-gold">Westerville Lions Club</h3>
            <p className="text-gray-400">
              Serving our community through humanitarian service since 1938.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-lions-gold">Quick Links</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/about" className="text-gray-400 hover:text-white transition">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/mission" className="text-gray-400 hover:text-white transition">
                  Our Mission
                </Link>
              </li>
              <li>
                <Link href="/events" className="text-gray-400 hover:text-white transition">
                  Events
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-lions-gold">Get Involved</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/donate" className="text-gray-400 hover:text-white transition">
                  Donate
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-gray-400 hover:text-white transition">
                  Contact Us
                </Link>
              </li>
              <li>
                <Link href="/signin" className="text-gray-400 hover:text-white transition">
                  Member Login
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-lions-gold">Contact</h4>
            <p className="text-gray-400">
              Westerville, Ohio
              <br />
              Email: info@westervillelions.org
            </p>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
          <p>&copy; {new Date().getFullYear()} Westerville Lions Club. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
