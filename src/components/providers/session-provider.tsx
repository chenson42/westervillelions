"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Thin client wrapper so the (server) root layout can mount NextAuth's
 * context provider without itself becoming a client component or calling
 * auth() server-side. See docs/work-log/2026-09-04-site-review-fixes.md,
 * "Batch 2 — static rendering": removing auth() from the root layout is
 * what unlocks static/ISR rendering for every public page — previously the
 * layout's server-side session fetch forced `cache-control: no-store` on
 * every single route in the app, public marketing pages included.
 *
 * Every client component below this provider (Header, SignOutButton, and
 * any future member-only widget on a public page) can call useSession()
 * and gets the session hydrated client-side via a fetch to
 * /api/auth/session — see Header for the pattern.
 */
export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
