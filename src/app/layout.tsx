import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { auth } from "@/lib/auth";

const siteUrl = "https://westervillelions.org";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Westerville Lions Club | Serving Westerville, OH Since 1928",
    template: "%s | Westerville Lions Club",
  },
  description:
    "Westerville Lions Club — a nonprofit serving Westerville, Ohio since 1928 through youth programs, hunger relief, humanitarian aid, and community service.",
  openGraph: {
    type: "website",
    siteName: "Westerville Lions Club",
    locale: "en_US",
    images: [
      {
        url: "/images/hero-bg.jpg",
        width: 1200,
        height: 630,
        alt: "Westerville Lions Club — Serving Westerville, OH Since 1928",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@LionWesterville",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "NGO",
  name: "Westerville Lions Club",
  url: siteUrl,
  logo: `${siteUrl}/images/logo-official.png`,
  foundingDate: "1928",
  description:
    "A 501(c)(3) nonprofit serving Westerville, Ohio through youth programs, hunger relief, humanitarian aid, and community service.",
  address: {
    "@type": "PostalAddress",
    streetAddress: "350 County Line Rd W",
    addressLocality: "Westerville",
    addressRegion: "OH",
    postalCode: "43082",
    addressCountry: "US",
  },
  email: "info@westervillelions.org",
  sameAs: [
    "https://www.facebook.com/WestervilleLions",
    "https://x.com/LionWesterville",
    "https://www.instagram.com/westervillelions",
    "https://www.lionsclubs.org",
  ],
  memberOf: {
    "@type": "Organization",
    name: "Lions Clubs International",
    url: "https://www.lionsclubs.org",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth().catch(() => null);

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&display=swap" rel="stylesheet" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>
        <Header session={session} />
        {children}
        <Footer />
      </body>
    </html>
  );
}
