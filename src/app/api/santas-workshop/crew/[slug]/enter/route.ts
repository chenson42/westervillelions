/**
 * POST /api/santas-workshop/crew/[slug]/enter  { code }  -> sets the crew cookie
 *
 * The one crew route that skips the crew gate: it IS the credential
 * exchange. Order: throttle -> verify -> cookie (enterWithCode). Wrong, revoked,
 * paused, closed and unknown-slug codes answer with one identical body.
 */

import { NextResponse } from "next/server";
import { defaultCrewAuthDeps } from "@/lib/santas-workshop/crew-auth";
import { enterWithCode } from "@/lib/santas-workshop/crew-entry";
import { crewOk, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { purposeKey, isProductionEnv } from "@/lib/santas-workshop/crew-secret";
import { dbAttemptStore } from "@/lib/santas-workshop/crew-throttle";
import type { EnterResponse } from "@/lib/santas-workshop/crew-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const body = (await readCrewJson(request)) as { code?: unknown } | null;
    const outcome = await enterWithCode(request, slug, body?.code, {
      loadSession: defaultCrewAuthDeps.loadSession,
      attempts: dbAttemptStore,
      now: () => new Date(),
      codeKey: () => purposeKey("code"),
      cookieKey: () => purposeKey("cookie"),
      ipKey: () => purposeKey("ip"),
      production: () => isProductionEnv(),
    });
    if (!outcome.ok) {
      return NextResponse.json(outcome.body, { status: outcome.status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    }
    const response: EnterResponse = { ok: true };
    return crewOk(response, 200, { "Set-Cookie": outcome.setCookie });
  } catch (e) {
    return crewServerError("enter", e);
  }
}
