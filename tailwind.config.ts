import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Westerville Lions Club brand colors (Lions International official)
        lions: {
          blue: "#003F87",
          "blue-dark": "#002d63",
          gold: "#F9B222",
          "gold-dark": "#e09d0f",
        },
        // Flat aliases
        "lions-blue": "#003F87",
        "lions-blue-dark": "#002d63",
        "lions-gold": "#F9B222",
        "lions-gold-dark": "#e09d0f",
      },
      fontFamily: {
        // next/font/google injects the actual font family via this CSS
        // variable (see src/app/layout.tsx) — 'Open Sans' stays as a
        // fallback name in case the variable is ever unset.
        sans: ['var(--font-open-sans)', 'Open Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
