import type { Metadata } from "next";
import { Open_Sans } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { AppSessionProvider } from "@/components/providers/session-provider";
import Script from "next/script";
import { Toaster } from "sonner";

const openSans = Open_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-open-sans",
});

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
        url: `${siteUrl}/images/og-default.jpg`,
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={openSans.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={openSans.className}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-lions-blue focus:text-white focus:rounded-lg focus:font-semibold"
        >
          Skip to main content
        </a>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-W30G7GD9HZ"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-W30G7GD9HZ');
          `}
        </Script>
        <AppSessionProvider>
          <Header />
          <main id="main-content">
            {children}
          </main>
          <Footer />
          <Toaster richColors position="top-center" />
        </AppSessionProvider>
      </body>
    </html>
  );
}
