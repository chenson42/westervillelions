"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

function toEmbedUrl(zeffyLink: string): string {
  if (zeffyLink.includes("/embed/")) return zeffyLink;
  return zeffyLink.replace(
    /^https:\/\/www\.zeffy\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?/,
    "https://www.zeffy.com/embed/"
  );
}

export function ZeffyEmbed({
  zeffyLink,
  label = "Donate Now",
  description,
}: {
  zeffyLink: string;
  label?: string;
  description?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const embedUrl = toEmbedUrl(zeffyLink);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const modal = open && mounted ? createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Dialog panel — fixed height so iframe fills it, no external scroll */}
      <div className="relative z-10 w-full max-w-2xl h-[88vh] flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 bg-lions-blue text-white flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold">{label}</h2>
            {description && (
              <p className="mt-1 text-sm text-blue-100 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-4 flex-shrink-0 rounded-full p-1 hover:bg-white/20 transition"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* iframe fills remaining modal height exactly — Zeffy scrolls internally */}
        <div className="flex-1 overflow-hidden">
          <iframe
            title="Donation form powered by Zeffy"
            src={embedUrl}
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            // @ts-expect-error — allowpaymentrequest is a valid iframe attribute
            allowpaymentrequest="true"
            allowTransparency={true}
          />
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full bg-lions-gold text-gray-900 px-6 py-3 rounded-lg font-bold text-lg hover:bg-lions-gold-dark transition shadow-lg"
      >
        {label}
      </button>
      {modal}
    </>
  );
}
