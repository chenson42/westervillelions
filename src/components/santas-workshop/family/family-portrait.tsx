"use client";

import { useState } from "react";
import { FAMILY_COPY } from "@/lib/santas-workshop/family-ui";

/** The stuffy's portrait from the family door. A picture the store cannot serve shows a quiet line, never a broken icon. */
export function FamilyPortraitImage({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return <p className="rounded-2xl bg-gray-50 p-10 text-center text-gray-500">{FAMILY_COPY.portraitMissing}</p>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the family photo door, not a static asset
    <img src={src} alt={alt} onError={() => setBroken(true)} className="sw-family-portrait mx-auto w-full max-w-lg rounded-2xl bg-white shadow-sm" data-testid="family-portrait" />
  );
}
