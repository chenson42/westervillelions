import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next v16 ships native flat configs. Loading them through
// @eslint/eslintrc's FlatCompat (the old Next scaffold) crashed ESLint outright:
// FlatCompat pulled in minimatch, which the repo-wide `minimatch: ^10` override
// forced to an ESM-only build with no default export, and once that was pinned
// back the legacy schema validator then choked on the modern config shape.
// Importing the flat configs directly removes the compat layer entirely.
export default [...coreWebVitals, ...typescript];
