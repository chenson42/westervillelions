// Single source of truth for the eight Lions Clubs International global
// causes, shared between the homepage "Our Service Areas" navigation band
// (src/components/home/service-areas.tsx) and the /mission "How We Serve"
// deep-dive grid (src/app/mission/page.tsx). Both surfaces render the
// shared hand-drawn stroke icon set from src/components/cause-icon.tsx,
// keyed by slug.
//
// Order is deliberate and community-forward, per the Brand Guidelines in
// CLAUDE.md (de-emphasize vision rather than lead with it): Community
// Service, Youth Programs, Hunger Relief, Environment, Vision, Diabetes
// Awareness, Childhood Cancer, Humanitarian Aid.
//
// Slugs are load-bearing anchor targets (linked from the homepage as
// /mission#<slug>) and must never change.
export type Cause = {
  slug: string;
  title: string;
  description: string;
};

export const causes: Cause[] = [
  {
    slug: "community-service",
    title: "Community Service",
    description:
      "From holiday drives to civic events, we roll up our sleeves alongside neighbors to address Westerville's pressing needs.",
  },
  {
    slug: "youth-programs",
    title: "Youth Programs",
    description:
      "Investing in the next generation through scholarships, educational programs, and youth leadership development opportunities.",
  },
  {
    slug: "hunger-relief",
    title: "Hunger Relief",
    description:
      "Partnering with local food banks and meal programs to ensure no family in Westerville goes without nutritious food.",
  },
  {
    slug: "environment",
    title: "Environment",
    description:
      "Protecting our community's natural resources through conservation efforts, clean-up events, and environmental education.",
  },
  {
    slug: "vision",
    title: "Vision",
    description:
      "Fighting preventable blindness through vision screenings, eyeglass collection and recycling, and connecting those in need with affordable eye care.",
  },
  {
    slug: "diabetes-awareness",
    title: "Diabetes Awareness",
    description:
      "Promoting diabetes prevention, education, and support for those living with the disease in our community.",
  },
  {
    slug: "childhood-cancer",
    title: "Childhood Cancer",
    description:
      "Supporting children and families facing cancer through fundraising and awareness in partnership with Lions Clubs International Foundation.",
  },
  {
    slug: "humanitarian-aid",
    title: "Humanitarian Aid",
    description:
      "When disaster strikes — locally or globally — we mobilize to provide relief through our network of Lions Clubs International.",
  },
];
