"use client";

import { useEffect, useState } from "react";
import { qrText } from "@/lib/santas-workshop/collage-ui";

/** The collage QR, drawn in the browser from the server's `qrPayload`, verbatim. */
export function CollageQr({ collage }: { collage: { qrPayload: string } }) {
  const text = qrText(collage);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode").then(async (mod) => {
      const url = await mod.toDataURL(text, { width: 480, margin: 4, errorCorrectionLevel: "M" });
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [text]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
    <img src={src} alt="QR code for the collage link" width={160} height={160} className="h-40 w-40 rounded-lg border border-gray-200" />
  ) : (
    <div className="h-40 w-40 animate-pulse rounded-lg bg-gray-100" aria-hidden="true" />
  );
}
