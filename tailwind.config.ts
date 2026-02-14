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
        // Westerville Lions Club brand colors (updated to red/gold)
        lions: {
          red: "#CC0000",
          "red-dark": "#990000",
          gold: "#FFD700",
          "gold-dark": "#E6C200",
        },
        // Backward compatibility aliases
        "lions-red": "#CC0000",
        "lions-gold": "#FFD700",
      },
      fontFamily: {
        sans: ['Open Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
