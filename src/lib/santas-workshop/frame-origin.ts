/**
 * The production-origin guard for frame export (Slice 4). Pure and client-safe.
 *
 * A frame prints the collage link as a QR code that outlives the event by years, so a
 * REAL session's frames may only be made when the collage link starts with the club's
 * production origin. `getAppUrl()` falls back to the production origin when NEXTAUTH_URL is
 * unset, which on a preview deployment would print a QR into a database the preview does not
 * have, so a real session also refuses to run on any Vercel environment that is not production.
 *
 * Practice sessions are exempt (their frames carry a PRACTICE band and are not for print).
 * A developer may set SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN=1 to export from localhost; that
 * switch is ignored when the runtime is production.
 */

import type { SessionKind } from "./session-vocabulary";

export const PRODUCTION_ORIGIN = "https://westervillelions.org";
export const FRAME_ORIGIN_OVERRIDE_ENV = "SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN";

export interface FrameOriginEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  [FRAME_ORIGIN_OVERRIDE_ENV]?: string;
}

/** Production means Vercel production, or (off Vercel) NODE_ENV=production. */
export function isProductionRuntime(env: FrameOriginEnv): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export function startsWithProductionOrigin(url: string): boolean {
  return url.startsWith(`${PRODUCTION_ORIGIN}/`);
}

export function frameOriginAllowed(url: string, sessionKind: SessionKind, env: FrameOriginEnv): boolean {
  if (sessionKind === "practice") return true;
  const overridden = env[FRAME_ORIGIN_OVERRIDE_ENV] === "1" && !isProductionRuntime(env);
  if (overridden) return true;
  const onProductionDeploy = !env.VERCEL_ENV || env.VERCEL_ENV === "production";
  return onProductionDeploy && startsWithProductionOrigin(url);
}
