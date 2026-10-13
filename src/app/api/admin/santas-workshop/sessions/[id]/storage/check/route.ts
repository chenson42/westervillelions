/**
 * POST /api/admin/santas-workshop/sessions/[id]/storage/check  { action?: "delete_orphans" }  -> StorageCheckResponse
 *
 * Lists the session's folder and compares it with the photo rows: files with no row
 * (older than 10 minutes) and rows with no file. Only "delete_orphans" deletes, and
 * only the orphans just listed.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, notFound, ok, readJson, serverError, storageFailure, unauthorized } from "@/lib/santas-workshop/admin-http";
import { getSessionRow } from "@/lib/santas-workshop/session-queries";
import { checkStorage } from "@/lib/santas-workshop/storage-admin";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const row = await getSessionRow(id);
    if (!row) return notFound("Session not found");
    const body = (await readJson(request)) as { action?: unknown } | null;
    if (body?.action !== undefined && body.action !== "delete_orphans") return adminError(400, "invalid_input", "Unknown action", "action");
    return ok(await checkStorage(row, body?.action === "delete_orphans", session.user.id));
  } catch (e) {
    return storageFailure(e) ?? serverError("check storage", e);
  }
}
