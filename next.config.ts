import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
