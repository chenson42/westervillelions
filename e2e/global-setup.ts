/**
 * Playwright globalSetup — warms the dev server's route compilation BEFORE any
 * test runs.
 *
 * Why this exists (2026-09-10): `pnpm dev` compiles routes on first request.
 * Signing in pulls in `/signin`, the NextAuth credentials route and the
 * destination page all at once, and on a cold server that regularly took longer
 * than Playwright's 30s per-test timeout. Whichever spec happened to run FIRST
 * would fail in `signInAsAdmin()`, and because most suites are
 * `describe.serial`, the rest of that file was skipped.
 *
 * That produced three separate, unrelated-looking "failures" in one day —
 * receipt-heic-upload, ack-queue-workflow and budget-star-notes — none of which
 * had anything wrong with them. Each passed on a warm re-run. That is the worst
 * kind of flake: it teaches you to shrug and re-run, which is exactly the habit
 * that let a real production regression sit unnoticed for five days behind a
 * wall of "known" failures.
 *
 * Raising the per-test timeout instead would have been the wrong fix — it makes
 * every genuine hang take longer to report, to paper over a cost that only ever
 * occurs once per server. Paying it here, once, keeps the per-test bound tight
 * and meaningful.
 *
 * Deliberately unauthenticated: these GETs mostly redirect to /signin, which is
 * fine — the redirect still forces Next to compile the route being requested,
 * and the sign-in path is the one that was timing out. No fixtures are created
 * and nothing is written, so this is safe to run against any target database.
 */
const WARM_PATHS = [
  "/", // root layout + shared chunks
  "/signin", // the credentials form itself
  "/members", // redirect target after a successful sign-in
  "/admin", // admin layout + nav, shared by every admin spec

  // The NextAuth route handler — THE important one, and the reason this file
  // exists at all. next-auth's client `signIn()` first GETs /api/auth/csrf to
  // obtain a CSRF token. On a cold server that request is what compiles the
  // whole /api/auth/[...nextauth] handler, and the sign-in POST raced it: the
  // dev log showed `[auth][error] MissingCSRF: CSRF token was missing during an
  // action callback`, a 200 back from the callback, and the browser bounced to
  // /signin?callbackUrl=%2Fmembers still unauthenticated.
  //
  // That presents as a *timeout* in signInAsAdmin()'s waitForURL, which is a
  // thoroughly misleading symptom — the sign-in didn't take too long, it FAILED
  // and the wait was never going to be satisfied. Raising that timeout (tried
  // first, reverted) treats the symptom and cannot fix it.
  //
  // Production is unaffected: routes are compiled ahead of time there, so this
  // race only exists against `pnpm dev`.
  "/api/auth/csrf",
  "/api/auth/session",
  "/api/auth/providers",
];

export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

  // Generous per-request budget: a cold Next dev compile of the admin tree can
  // legitimately take tens of seconds on a loaded machine. This is a one-time
  // cost, not a per-test one.
  const perRequestTimeoutMs = 120_000;

  for (const path of WARM_PATHS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perRequestTimeoutMs);
    try {
      await fetch(`${baseURL}${path}`, {
        signal: controller.signal,
        redirect: "follow",
      });
    } catch {
      // Warming is best-effort. If the server isn't up yet, or a route errors,
      // let the tests run and report the real failure themselves — a warm-up
      // must never be the thing that fails your suite.
    } finally {
      clearTimeout(timer);
    }
  }
}
