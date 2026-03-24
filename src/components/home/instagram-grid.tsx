"use client";

import { useEffect } from "react";

export function InstagramGrid() {
  useEffect(() => {
    // Load Instagram embed script
    const script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    document.body.appendChild(script);

    // Process embeds when script loads
    script.onload = () => {
      if ((window as any).instgrm) {
        (window as any).instgrm.Embeds.process();
      }
    };

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div className="max-w-7xl mx-auto flex justify-center">
      <iframe
        src="https://www.instagram.com/westervillelions/embed"
        width="100%"
        height="600"
        style={{ border: 0 }}
        scrolling="no"
        className="max-w-xl rounded-lg shadow-lg"
      />
    </div>
  );
}
