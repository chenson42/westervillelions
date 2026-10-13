import type { Metadata, Viewport } from "next";

// The crew screen is for volunteers' phones only: never indexed, never cached, and
// sized for a phone (no pinch-zoom lock, but the camera and the keyboard behave).
export const metadata: Metadata = {
  title: "Crew",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
