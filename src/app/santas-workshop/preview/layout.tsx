import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { PrototypeShell } from "@/components/santas-workshop/prototype-shell";
import "./santas-workshop.css";

// Self-hosted by next/font at build time, so the CSP `font-src 'self'` holds
// exactly as it does for Open Sans.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sw-display",
});

// Unlisted prototype (DECISION-118): noindex/nofollow here cascades to every
// child page. Nothing here points crawlers at a real page, on purpose.
export const metadata: Metadata = {
  title: "Santa's Workshop (prototype)",
  description: "Prototype with sample content. Nothing here is real or saved.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Santa's Workshop (prototype)",
    description: "Prototype with sample content.",
  },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`sw-root ${fraunces.variable}`}>
      <PrototypeShell>{children}</PrototypeShell>
    </div>
  );
}
