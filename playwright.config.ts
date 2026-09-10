import { defineConfig, devices } from "@playwright/test";

// .env.local is loaded by the `dotenv-cli` prefix on the `test:e2e` script
// (see package.json) — keeps env loading consistent with the rest of the project.

export default defineConfig({
  testDir: "./e2e",
  // Warms the dev server's route compilation once, before any test runs, so a
  // cold `pnpm dev` doesn't blow the first test's timeout inside signInAsAdmin().
  // See e2e/global-setup.ts for the incident this fixes.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Always 1, locally as well as on CI. Every spec in this suite runs against the
  // SAME database (`.env.local`'s DATABASE_URL) and asserts on counts and on
  // preconditions like "no minutes exist for the current fiscal year" — state a
  // concurrently-running spec can invalidate. Local multi-worker runs produced 4
  // failures that vanished on a serial re-run (2026-09-09), which is pure noise:
  // it hides real regressions behind false ones. CI was already serial for this
  // reason; this only makes local runs agree with it. The cost is wall-clock
  // (~2.5min -> ~12min), which is worth an e2e signal you can actually trust.
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
