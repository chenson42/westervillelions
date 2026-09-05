"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { SignOutButton } from "./signout-button";
import { canAccessAdminArea } from "@/lib/permissions";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  // The root layout no longer fetches the session server-side (that forced
  // every public page dynamic — see docs/work-log/2026-09-04-site-review-fixes.md,
  // "Batch 2 — static rendering"). Header now hydrates its own account area
  // client-side via next-auth's useSession(), which fetches
  // /api/auth/session on mount. Until that resolves, `session` is
  // undefined/null and we render the signed-out state (Member Login) — the
  // same markup the server would have produced for an anonymous visitor.
  // A signed-in member sees a brief flash of "Member Login" before the
  // real session loads; that's an accepted tradeoff for making every public
  // page cacheable.
  const { data: session } = useSession();

  // Admin pages have their own sidebar navigation
  if (pathname.startsWith("/admin")) return null;

  const navLinks = [
    { href: "/about", label: "About" },
    { href: "/mission", label: "Mission & Service" },
    { href: "/programs", label: "Programs" },
    { href: "/events", label: "Events" },
    { href: "/connect", label: "Connect" },
  ];

  const isActive = (href: string) => pathname === href;

  return (
    // print:hidden mirrors Footer — site chrome must never appear in a printed
    // document. Without it the nav (logo, Donate, Admin, Sign Out) rendered on
    // page 1 of every print surface: the member directory, the board-ready
    // budget worksheet, and the monthly financial statements.
    <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50 print:hidden">
      <nav className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/" className="flex items-center">
              <div className="relative h-16 md:h-20 lg:h-24 flex-shrink-0">
                <Image
                  src="/images/logo-official.png"
                  alt="Westerville Lions Club"
                  width={300}
                  height={96}
                  className="h-full w-auto object-contain"
                  priority
                />
              </div>
            </Link>
            <div className="hidden xl:flex space-x-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-gray-700 hover:text-lions-blue transition font-medium ${
                    isActive(link.href) ? "text-lions-blue border-b-2 border-lions-blue" : ""
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/donate"
              className="hidden md:inline-block bg-lions-gold text-lions-blue-dark px-4 py-2 rounded-lg font-semibold hover:brightness-95 transition"
            >
              Donate
            </Link>
            {session?.user ? (
              <>
                {canAccessAdminArea(session.user.features) && (
                  <Link
                    href="/admin"
                    className="hidden md:inline-block text-gray-700 hover:text-lions-blue transition font-medium"
                  >
                    Admin
                  </Link>
                )}
                <Link
                  href="/members"
                  className="hidden md:inline-block bg-lions-blue text-white px-4 py-2 rounded-lg hover:bg-lions-blue-dark transition"
                >
                  Member Portal
                </Link>
                <SignOutButton className="hidden md:inline-block text-gray-700 hover:text-lions-blue transition font-medium" />
              </>
            ) : (
              <Link
                href="/signin"
                className="hidden md:inline-block text-gray-500 hover:text-lions-blue transition text-sm font-medium"
              >
                Member Login
              </Link>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="xl:hidden p-2 text-gray-700 hover:text-lions-blue"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="xl:hidden mt-4 pb-4 border-t border-gray-200 pt-4">
            <div className="flex flex-col space-y-3">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`text-gray-700 hover:text-lions-blue transition font-medium px-2 py-2 ${
                    isActive(link.href) ? "text-lions-blue bg-blue-50 rounded" : ""
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/donate"
                onClick={() => setMobileMenuOpen(false)}
                className="bg-lions-gold text-lions-blue-dark px-4 py-2 rounded-lg font-semibold text-center hover:brightness-95 transition"
              >
                Donate
              </Link>
              {session?.user ? (
                <>
                  {canAccessAdminArea(session.user.features) && (
                    <Link
                      href="/admin"
                      onClick={() => setMobileMenuOpen(false)}
                      className="text-gray-700 hover:text-lions-blue transition font-medium px-2 py-2"
                    >
                      Admin
                    </Link>
                  )}
                  <Link
                    href="/members"
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-gray-700 hover:text-lions-blue transition font-medium px-2 py-2"
                  >
                    Member Portal
                  </Link>
                  <SignOutButton className="text-left w-full text-gray-700 hover:text-lions-blue transition font-medium px-2 py-2" />
                </>
              ) : (
                <Link
                  href="/signin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="bg-lions-blue text-white px-4 py-2 rounded-lg hover:bg-lions-blue-dark transition text-center"
                >
                  Member Login
                </Link>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
