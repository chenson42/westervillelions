import type { ReactNode, SVGProps } from "react";

// Shared per-cause icon set for the eight Lions Clubs International global
// causes, keyed by the slugs in src/lib/causes.ts. Used by both the
// homepage "Our Service Areas" navigation band
// (src/components/home/service-areas.tsx) and /mission's "How We Serve"
// deep-dive cards (src/app/mission/page.tsx) so the two surfaces render
// the identical icon rather than one using emoji and the other SVG.
//
// Hand-drawn 24×24-grid stroke paths (strokeWidth 1.5, round caps/joins)
// matching the heroicon-style SVGs already used across the site — no icon
// library dependency. Path data is byte-identical to the set that
// previously lived inline in service-areas.tsx.
const paths: Record<string, ReactNode> = {
  "community-service": (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 8.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 8.25a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 19.5a4.5 4.5 0 0 1 9 0"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.02 15.34a4.5 4.5 0 0 1 7.23 4.16"
      />
    </>
  ),
  "youth-programs": (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5 2.25 9 12 13.5 21.75 9 12 4.5Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 11.4v4.35c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25V11.4"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v4.5" />
    </>
  ),
  "hunger-relief": (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75h15a7.5 7.5 0 0 1-7.5 7.5 7.5 7.5 0 0 1-7.5-7.5Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 9.75c0-.9.9-1.35.9-2.25 0-.75-.45-1.05-.45-1.75"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 9.75c0-.9.9-1.35.9-2.25 0-.75-.45-1.05-.45-1.75"
      />
    </>
  ),
  environment: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 12.75C12 8.6 8.6 6 4.5 6c0 4.1 3.4 6.75 7.5 6.75Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9.75c0-3.45 2.8-6 7.5-6 0 4.5-3.4 6-7.5 6Z"
      />
    </>
  ),
  vision: (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </>
  ),
  "diabetes-awareness": (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.75s6 6.25 6 10.5a6 6 0 1 1-12 0c0-4.25 6-10.5 6-10.5Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 14.25a2.25 2.25 0 0 0 2.25 2.25"
      />
    </>
  ),
  "childhood-cancer": (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.75c-1.8 0-3 1.35-3 3 0 2.4 2.1 4.05 3 4.8.9-.75 3-2.4 3-4.8 0-1.65-1.2-3-3-3Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.9 10.4 5.5 9.85" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.1 10.4-5.5 9.85" />
    </>
  ),
  "humanitarian-aid": (
    <>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.3 12h17.4" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3c2.5 2.4 3.75 5.4 3.75 9S14.5 18.6 12 21c-2.5-2.4-3.75-5.4-3.75-9S9.5 5.4 12 3Z"
      />
    </>
  ),
};

type CauseIconProps = SVGProps<SVGSVGElement> & {
  slug: string;
};

export function CauseIcon({ slug, className, ...props }: CauseIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      {...props}
    >
      {paths[slug]}
    </svg>
  );
}
