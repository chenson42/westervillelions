"use client";

import { useEffect, useState } from "react";
import { FAMILY_COPY } from "@/lib/santas-workshop/family-ui";

/**
 * Print-only block: a QR for the collage drawn in the browser from the absolute
 * link, with the words caption beside it. The token appears in print only as the
 * QR itself, never as visible text. Hidden on screen (the link above is the screen path).
 */
export function FamilyPrintQr({ collagePath }: { collagePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const text = new URL(collagePath, window.location.origin).toString();
    void import("qrcode").then(async (mod) => {
      const url = await mod.toDataURL(text, { width: 480, margin: 4, errorCorrectionLevel: "M" });
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [collagePath]);
  return (
    <div className="mt-6 hidden items-center gap-6 print:flex" data-testid="family-print-qr">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
        <img src={src} alt="QR code for the whole day's photos" width={160} height={160} className="h-40 w-40" />
      )}
      <p className="text-lg font-semibold">
        {FAMILY_COPY.printScan}
        <br />
        <span className="font-normal">{FAMILY_COPY.printSite}</span>
      </p>
    </div>
  );
}
