/**
 * The first two statements of every sweep-batch route (B-172 Increment 2a):
 * `auth()` (401), then the feature check (403 `Forbidden`, identical for every
 * id, existing or not). Shared so the five routes cannot drift.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES, type FeatureName } from "@/lib/permissions";

export type SweepGate =
  | { ok: true; userId: string; callerCanManage: boolean }
  | { ok: false; response: NextResponse };

/** Which keys open a route: all of them are tried, any one is enough. */
export async function authorizeSweep(anyOf: readonly FeatureName[]): Promise<SweepGate> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = session.user.id;
  let allowed = false;
  for (const feature of anyOf) {
    if (await hasFeature(userId, feature)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const callerCanManage = anyOf.includes(FEATURES.LEDGER_MANAGE)
    ? true
    : await hasFeature(userId, FEATURES.LEDGER_MANAGE);
  return { ok: true, userId, callerCanManage };
}
