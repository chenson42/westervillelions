import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white">
      <div className="relative w-full">
        <Image
          src="/images/404-lion.jpg"
          alt="A lion resting its head on stone numerals reading 404 at sunset"
          width={1536}
          height={1024}
          priority
          sizes="100vw"
          className="w-full h-auto"
        />
      </div>

      <div className="container mx-auto px-4 py-12 max-w-2xl text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Page not found</h1>
        <p className="text-lg text-gray-600 mb-8">
          The page you're looking for doesn't exist or may have moved. Here are some places to go instead.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            href="/"
            className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Return home
          </Link>
          <Link
            href="/events"
            className="border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Upcoming events
          </Link>
          <Link
            href="/connect"
            className="border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
          >
            Contact us
          </Link>
        </div>
      </div>
    </div>
  );
}
