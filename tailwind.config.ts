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
        // Westerville Lions Club brand colors
        lions: {
          red: "#CC0000",
          "red-dark": "#990000",
          gold: "#FFD700",
        },
      },
    },
  },
  plugins: [],
};

export default config;
