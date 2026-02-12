import Link from "next/link";
import { auth } from "@/lib/auth";

export async function Header() {
  const session = await auth();

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <nav className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/" className="text-2xl font-bold text-lions-red">
              Westerville Lions
            </Link>
            <div className="hidden md:flex space-x-6">
              <Link href="/about" className="text-gray-700 hover:text-lions-red transition">
                About
              </Link>
              <Link href="/mission" className="text-gray-700 hover:text-lions-red transition">
                Mission
              </Link>
              <Link href="/events" className="text-gray-700 hover:text-lions-red transition">
                Events
              </Link>
              <Link href="/donate" className="text-gray-700 hover:text-lions-red transition">
                Donate
              </Link>
              <Link href="/contact" className="text-gray-700 hover:text-lions-red transition">
                Contact
              </Link>
            </div>
          </div>
          <div>
            {session?.user ? (
              <Link
                href="/members"
                className="bg-lions-red text-white px-4 py-2 rounded-lg hover:bg-lions-red-dark transition"
              >
                Member Portal
              </Link>
            ) : (
              <Link
                href="/signin"
                className="bg-lions-red text-white px-4 py-2 rounded-lg hover:bg-lions-red-dark transition"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
