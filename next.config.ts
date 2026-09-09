import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://www.zeffy.com\"), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'wasm-unsafe-eval' is load-bearing — do not remove it without reading this.
      //
      // The HEIC receipt-upload fallback (DECISION-038) decodes iPhone photos in the
      // browser with `libheif-js/wasm-bundle`, which inlines its WASM as base64 and
      // must instantiate it at runtime. Chrome and Firefox refuse to instantiate ANY
      // WebAssembly unless script-src grants 'wasm-unsafe-eval' (or the much broader
      // 'unsafe-eval'). Those browsers have no native HEIC decode, which is the entire
      // reason the WASM fallback exists — so without this token, every Chrome/Firefox
      // admin uploading a phone photo of a receipt fails, and the UI misreports it as a
      // connectivity problem.
      //
      // v1.75.0 (commit 4aea4f8) dropped 'unsafe-eval' as CSP hardening and silently
      // broke exactly that flow for five days; nothing recorded the dependency, so it
      // wasn't re-checked. 'wasm-unsafe-eval' is deliberately used here instead of
      // restoring 'unsafe-eval': it permits WebAssembly compilation ONLY, and still
      // forbids eval() of JavaScript strings, so v1.75.0's hardening is kept.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: lh3.googleusercontent.com",
      "font-src 'self'",
      "connect-src 'self' https://challenges.cloudflare.com https://www.google-analytics.com https://region1.google-analytics.com",
      "frame-src https://challenges.cloudflare.com https://maps.google.com https://www.google.com https://www.zeffy.com",
      "worker-src 'self' blob:",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/contact",
        destination: "/connect",
        permanent: true,
      },
      {
        source: "/what-we-do",
        destination: "/mission",
        permanent: true,
      },
      {
        source: "/our-cause",
        destination: "/mission",
        permanent: true,
      },
      {
        source: "/our-mission",
        destination: "/mission",
        permanent: true,
      },
      {
        source: "/our-organization",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/upcoming-events",
        destination: "/events",
        permanent: true,
      },
      {
        source: "/lions-member-area",
        destination: "/members",
        permanent: true,
      },
      {
        source: "/lions-member-area-old",
        destination: "/members",
        permanent: true,
      },
      {
        source: "/team/:slug",
        destination: "/about",
        permanent: true,
      },
      {
        source: "/pulledporkdinner",
        destination: "/events",
        permanent: true,
      },
      {
        source: "/thank-you",
        destination: "/",
        permanent: true,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
    // Next.js 16 defaults to denying a query string on ANY local (same-
    // origin) next/image src unless images.localPatterns is configured —
    // site-review-fixes Batch 3's event-image serve route
    // (GET /api/public/events/[id]/image) is versioned via a `?v=` cache-
    // buster, so it needs an explicit allow. The second entry reproduces
    // the framework's implicit prior default (no query string) for every
    // other local image path, since configuring localPatterns at all
    // replaces that default rather than extending it.
    localPatterns: [
      { pathname: "/api/public/events/**" },
      { pathname: "**", search: "" },
    ],
  },
};

export default nextConfig;
