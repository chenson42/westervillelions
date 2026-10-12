import { Fraunces } from "next/font/google";
import "./santas-workshop.css";

// Self-hosted by next/font at build time, so the CSP `font-src 'self'` holds
// exactly as it does for Open Sans.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sw-display",
});

// Fonts and scoped CSS tokens only. This layout sets NO robots and NO
// canonical: later routes under this segment (crew, collage, family pages) set
// their own, and metadata merges shallowly.
export default function SantasWorkshopLayout({ children }: { children: React.ReactNode }) {
  return <div className={`sw-root ${fraunces.variable}`}>{children}</div>;
}
