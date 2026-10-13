/**
 * POST /api/admin/santas-workshop/storage/test  { sessionId? }  -> StorageTestResponse
 * Writes, reads back and deletes a tiny object in the photo store and logs the result
 * (a real session cannot be activated without a passing test in the last 10 minutes).
 * A failure is 503 with the storage code, never a stack trace.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, ok, readJson, serverError, storageFailure, unauthorized } from "@/lib/santas-workshop/admin-http";
import { runStorageTest } from "@/lib/santas-workshop/storage-admin";

export const maxDuration = 30;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  try {
    const body = (await readJson(request)) as { sessionId?: unknown } | null;
    const sessionId = typeof body?.sessionId === "string" && isUuid(body.sessionId) ? body.sessionId : undefined;
    return ok(await runStorageTest(sessionId, session.user.id));
  } catch (e) {
    return storageFailure(e) ?? serverError("storage test", e);
  }
}
