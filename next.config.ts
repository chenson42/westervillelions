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
