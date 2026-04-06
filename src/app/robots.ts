import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/members", "/admin", "/api"],
    },
    sitemap: "https://westervillelions.org/sitemap.xml",
  };
}
