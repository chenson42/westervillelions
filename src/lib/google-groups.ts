/**
 * Google Groups sync utility
 *
 * Uses OAuth2 refresh token to authenticate as GOOGLE_ADMIN_EMAIL
 * and sync a portal group's members to a Google Group.
 */

import { google } from "googleapis";
import { db } from "@/lib/db";
import { groups, groupMemberships, members, googleGroupSyncLog } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { MembershipStatus } from "@/lib/members";
import { CLUB_GROUP_EMAIL } from "@/lib/club-contacts";

// Re-exported for any DB-coupled consumer that wants it from here (this file
// is the natural place to look for it, since it's the module that actually
// syncs members to this address). The canonical definition now lives in
// src/lib/club-contacts.ts — a dependency-free module — so that
// src/lib/minutes.ts (which must stay importable without @/lib/db, see its
// own header comment) can share the same source of truth instead of
// duplicating the literal. DECISION-075 §7 / DECISION-077 §4.
export { CLUB_GROUP_EMAIL };

/** club@ list eligibility (decision: prospects ride the list, ended members don't). */
export const CLUB_LIST_ELIGIBLE_STATUSES = ["active", "prospective"] as const;

export function isEligibleForClubList(status: MembershipStatus): boolean {
  return (CLUB_LIST_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export type SyncTriggerSource = "manual" | "member_added" | "member_removed" | "member_updated";

interface SyncContext {
  triggeredByUserId?: string | null;
  triggerSource?: SyncTriggerSource;
}

async function writeSyncLog(params: {
  groupEmail: string;
  groupId?: string | null;
  triggeredByUserId?: string | null;
  triggerSource: SyncTriggerSource;
  success: boolean;
  added: string[];
  removed: string[];
  failed: SyncFailure[];
  error?: string | null;
}) {
  try {
    await db.insert(googleGroupSyncLog).values({
      groupEmail: params.groupEmail,
      groupId: params.groupId ?? null,
      triggeredByUserId: params.triggeredByUserId ?? null,
      triggerSource: params.triggerSource,
      success: params.success,
      added: params.added,
      removed: params.removed,
      failed: params.failed,
      error: params.error ?? null,
    });
  } catch (logErr) {
    console.error("[google-groups] Failed to write sync log:", logErr);
  }
}

export interface SyncFailure {
  email: string;
  op: "add" | "remove";
  error: string;
}

export interface SyncResult {
  success: boolean;
  added?: string[];
  removed?: string[];
  failed?: SyncFailure[];
  error?: string;
}

function describeApiError(err: unknown): string {
  if (err && typeof err === "object") {
    // googleapis errors expose a structured response on err.response.data.error
    const e = err as { response?: { data?: { error?: { message?: string; code?: number } } }; message?: string };
    const apiMessage = e.response?.data?.error?.message;
    if (apiMessage) return apiMessage;
    if (e.message) return e.message;
  }
  return String(err);
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number; status?: number; response?: { status?: number; data?: { error?: { code?: number } } } };
  const code = e.code ?? e.status ?? e.response?.status ?? e.response?.data?.error?.code;
  return code === 404;
}

// Newly created Google Groups are not always immediately queryable by groupKey —
// propagation typically takes a few seconds. Retry on 404 with backoff.
async function retryOnNotFound<T>(fn: () => Promise<T>, attempts = 4, delayMs = 2000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isNotFoundError(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

/**
 * Sync all active members to club@westervillelions.org.
 * Fire-and-forget safe — catches all errors internally. A bad email
 * (e.g. typo, deleted Gmail) is logged and skipped; the rest of the
 * batch continues. Every run is recorded in google_group_sync_log.
 */
export async function syncClubMembersList(ctx: SyncContext = {}): Promise<SyncResult> {
  const triggerSource = ctx.triggerSource ?? "manual";
  try {
    const auth = getOAuthClient();
    const adminClient = google.admin({ version: "directory_v1", auth });

    // Ensure the Google Group exists
    try {
      await adminClient.groups.get({ groupKey: CLUB_GROUP_EMAIL });
    } catch {
      await adminClient.groups.insert({
        requestBody: {
          email: CLUB_GROUP_EMAIL,
          name: "Westerville Lions Club Members",
          description: "All active members of the Westerville Lions Club",
        },
      });
      try {
        const settingsClient = google.groupssettings({ version: "v1", auth });
        await settingsClient.groups.patch({
          groupUniqueId: CLUB_GROUP_EMAIL,
          requestBody: { whoCanPostMessage: "ANYONE", whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW" },
        });
      } catch (e) {
        console.warn("[google-groups] Failed to apply club group settings:", e);
      }
    }

    // Fetch current Google Group members
    const googleMembersRes = await adminClient.members.list({ groupKey: CLUB_GROUP_EMAIL });
    const googleMemberEmails = new Set<string>(
      (googleMembersRes.data.members ?? [])
        .map((m) => m.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    );

    // Fetch all club@-eligible portal members with email (active + prospective;
    // ended members are excluded). See isEligibleForClubList() above.
    const eligibleMembers = await db
      .select({ email: members.email })
      .from(members)
      .where(inArray(members.membershipStatus, CLUB_LIST_ELIGIBLE_STATUSES));

    const portalMemberEmails = new Set<string>(
      eligibleMembers
        .map((m) => m.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    );

    // Add missing, remove extra — per-email try/catch so one failure
    // doesn't stop the whole batch.
    const toAdd = [...portalMemberEmails].filter((e) => !googleMemberEmails.has(e));
    const toRemove = [...googleMemberEmails].filter((e) => !portalMemberEmails.has(e));
    const added: string[] = [];
    const removed: string[] = [];
    const failed: SyncFailure[] = [];

    for (const email of toAdd) {
      try {
        await adminClient.members.insert({ groupKey: CLUB_GROUP_EMAIL, requestBody: { email, role: "MEMBER" } });
        added.push(email);
      } catch (err) {
        const message = describeApiError(err);
        console.warn(`[google-groups] Failed to add ${email} to ${CLUB_GROUP_EMAIL}: ${message}`);
        failed.push({ email, op: "add", error: message });
      }
    }
    for (const email of toRemove) {
      try {
        await adminClient.members.delete({ groupKey: CLUB_GROUP_EMAIL, memberKey: email });
        removed.push(email);
      } catch (err) {
        const message = describeApiError(err);
        console.warn(`[google-groups] Failed to remove ${email} from ${CLUB_GROUP_EMAIL}: ${message}`);
        failed.push({ email, op: "remove", error: message });
      }
    }

    await writeSyncLog({
      groupEmail: CLUB_GROUP_EMAIL,
      triggeredByUserId: ctx.triggeredByUserId,
      triggerSource,
      success: true,
      added,
      removed,
      failed,
    });

    return { success: true, added, removed, failed };
  } catch (err) {
    const message = describeApiError(err);
    console.error("[google-groups] syncClubMembersList failed:", err);
    await writeSyncLog({
      groupEmail: CLUB_GROUP_EMAIL,
      triggeredByUserId: ctx.triggeredByUserId,
      triggerSource,
      success: false,
      added: [],
      removed: [],
      failed: [],
      error: message,
    });
    return { success: false, error: message };
  }
}

const DOMAIN = "westervillelions.org";

function getOAuthClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_GROUPS_CLIENT_ID,
    process.env.GOOGLE_GROUPS_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_GROUPS_REFRESH_TOKEN });
  // Impersonate the admin account for Directory API access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (auth as any).subject = process.env.GOOGLE_ADMIN_EMAIL;
  return auth;
}

export async function syncGoogleGroup(groupId: string, ctx: SyncContext = {}): Promise<SyncResult> {
  const triggerSource = ctx.triggerSource ?? "manual";
  let resolvedGroupEmail: string | null = null;
  try {
    // 1. Load the portal group
    const group = await db.query.groups.findFirst({
      where: eq(groups.id, groupId),
    });

    if (!group) {
      return { success: false, error: "Group not found" };
    }

    // 2. If no emailPrefix, return early
    if (!group.emailPrefix) {
      return { success: false, error: "No email prefix configured for this group" };
    }

    const groupEmail = `${group.emailPrefix}@${DOMAIN}`;
    resolvedGroupEmail = groupEmail;
    const auth = getOAuthClient();
    const adminClient = google.admin({ version: "directory_v1", auth });

    // 3. Get or create the Google Group
    let googleGroupExists = false;
    try {
      await adminClient.groups.get({ groupKey: groupEmail });
      googleGroupExists = true;
    } catch {
      // Group does not exist — will create below
    }

    if (!googleGroupExists) {
      await adminClient.groups.insert({
        requestBody: {
          email: groupEmail,
          name: group.name,
          description: group.description ?? undefined,
        },
      });

      // Apply group settings — best-effort, do not fail the sync if this errors.
      // Wrap in retryOnNotFound because the freshly created group may not yet
      // be visible to settings API.
      try {
        const settingsClient = google.groupssettings({ version: "v1", auth });
        await retryOnNotFound(() =>
          settingsClient.groups.patch({
            groupUniqueId: groupEmail,
            requestBody: {
              whoCanPostMessage: "ANYONE",
              whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
            },
          })
        );
      } catch (settingsErr) {
        console.warn("[google-groups] Failed to apply group settings:", settingsErr);
      }
    }

    // 4. Fetch current Google Group members. A freshly created group is empty
    // by definition and may not be queryable yet due to propagation, so skip
    // the API round-trip in that case.
    const googleMemberEmails = new Set<string>();
    if (googleGroupExists) {
      const googleMembersRes = await adminClient.members.list({ groupKey: groupEmail });
      for (const m of googleMembersRes.data.members ?? []) {
        const email = m.email?.toLowerCase();
        if (email) googleMemberEmails.add(email);
      }
    }

    // 5. Fetch portal group members with email addresses
    const portalMemberships = await db
      .select({
        email: members.email,
      })
      .from(groupMemberships)
      .innerJoin(members, eq(groupMemberships.memberId, members.id))
      .where(eq(groupMemberships.groupId, groupId));

    // Skip members with no email address
    const portalMemberEmails = new Set<string>(
      portalMemberships
        .map((m) => m.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    );

    // 6. Add missing members — per-email try/catch
    const toAdd = [...portalMemberEmails].filter((e) => !googleMemberEmails.has(e));
    const toRemove = [...googleMemberEmails].filter((e) => !portalMemberEmails.has(e));
    const added: string[] = [];
    const removed: string[] = [];
    const failed: SyncFailure[] = [];

    for (const email of toAdd) {
      try {
        await retryOnNotFound(() =>
          adminClient.members.insert({
            groupKey: groupEmail,
            requestBody: { email, role: "MEMBER" },
          })
        );
        added.push(email);
      } catch (err) {
        const message = describeApiError(err);
        console.warn(`[google-groups] Failed to add ${email} to ${groupEmail}: ${message}`);
        failed.push({ email, op: "add", error: message });
      }
    }

    // 7. Remove extra members (those in Google but not in portal)
    for (const email of toRemove) {
      try {
        await retryOnNotFound(() =>
          adminClient.members.delete({ groupKey: groupEmail, memberKey: email })
        );
        removed.push(email);
      } catch (err) {
        const message = describeApiError(err);
        console.warn(`[google-groups] Failed to remove ${email} from ${groupEmail}: ${message}`);
        failed.push({ email, op: "remove", error: message });
      }
    }

    // 8. Update sync status — success even with per-email failures so
    // the partial sync is recorded; surface failure summary in the error column.
    const syncError = failed.length > 0
      ? `${failed.length} member${failed.length === 1 ? "" : "s"} failed: ${failed.map((f) => `${f.email} (${f.error})`).join("; ")}`
      : null;

    await db
      .update(groups)
      .set({
        googleGroupSyncedAt: new Date(),
        googleGroupSyncError: syncError,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, groupId));

    await writeSyncLog({
      groupEmail,
      groupId,
      triggeredByUserId: ctx.triggeredByUserId,
      triggerSource,
      success: true,
      added,
      removed,
      failed,
    });

    return { success: true, added, removed, failed };
  } catch (err) {
    const message = describeApiError(err);
    console.error(`[google-groups] syncGoogleGroup failed for ${groupId}:`, err);

    await writeSyncLog({
      groupEmail: resolvedGroupEmail ?? `(group:${groupId})`,
      groupId,
      triggeredByUserId: ctx.triggeredByUserId,
      triggerSource,
      success: false,
      added: [],
      removed: [],
      failed: [],
      error: message,
    });

    // Persist the error so it appears in the admin UI
    try {
      await db
        .update(groups)
        .set({
          googleGroupSyncError: message,
          updatedAt: new Date(),
        })
        .where(eq(groups.id, groupId));
    } catch {
      // Best-effort — don't mask the original error
    }

    return { success: false, error: message };
  }
}
