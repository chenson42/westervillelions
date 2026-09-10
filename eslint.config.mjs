import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next v16 ships native flat configs. Loading them through
// @eslint/eslintrc's FlatCompat (the old Next scaffold) crashed ESLint outright:
// FlatCompat pulled in minimatch, which the repo-wide `minimatch: ^10` override
// forced to an ESM-only build with no default export, and once that was pinned
// back the legacy schema validator then choked on the modern config shape.
// Importing the flat configs directly removes the compat layer entirely.
const config = [
  {
    // Flat config does NOT read .gitignore — without this, ESLint lints build and
    // test OUTPUT. It was reporting a stale eslint-disable inside
    // coverage/block-navigation.js, a generated Istanbul artifact nobody authored.
    // These mirror the generated-output entries in .gitignore.
    ignores: [
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Honour the `_`-prefix convention this codebase already uses for
      // deliberately-unused bindings — unused route handler params
      // (`_request`), throwaway destructuring keys (`_k`), and unused mock
      // arguments (`_table`). Without these patterns the rule reports 7
      // warnings for code that is already saying "yes, on purpose", which
      // trains people to ignore the rule and buries the genuinely dead
      // bindings it exists to find.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default config;
