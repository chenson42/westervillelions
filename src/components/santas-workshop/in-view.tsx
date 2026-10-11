"use client";

import { useEffect, useRef } from "react";

/**
 * Sets data-go="true" on its wrapper once it scrolls into view. CSS decides
 * whether anything animates (only under prefers-reduced-motion: no-preference);
 * content is fully visible either way.
 */
export function InView({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.go = "true";
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`sw-train ${className}`}>
      {children}
    </div>
  );
}
