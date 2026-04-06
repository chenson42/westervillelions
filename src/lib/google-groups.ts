/**
 * Google Groups sync utility
 *
 * Uses OAuth2 refresh token to authenticate as GOOGLE_ADMIN_EMAIL
 * and sync a portal group's members to a Google Group.
 */

import { google } from "googleapis";
import { db } from "@/lib/db";
import { groups, groupMemberships, members } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const CLUB_GROUP_EMAIL = "club@westervillelions.org";

/**
 * Sync all active members to club@westervillelions.org.
 * Fire-and-forget safe — catches all errors internally.
 */
export async function syncClubMembersList(): Promise<{ success: boolean; error?: string }> {
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

    // Fetch all active portal members with email
    const activeMembers = await db
      .select({ email: members.email })
      .from(members)
      .where(and(eq(members.isActive, true)));

    const portalMemberEmails = new Set<string>(
      activeMembers
        .map((m) => m.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    );

    // Add missing, remove extra
    for (const email of [...portalMemberEmails].filter((e) => !googleMemberEmails.has(e))) {
      await adminClient.members.insert({ groupKey: CLUB_GROUP_EMAIL, requestBody: { email, role: "MEMBER" } });
    }
    for (const email of [...googleMemberEmails].filter((e) => !portalMemberEmails.has(e))) {
      await adminClient.members.delete({ groupKey: CLUB_GROUP_EMAIL, memberKey: email });
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-groups] syncClubMembersList failed:", err);
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

export async function syncGoogleGroup(
  groupId: string
): Promise<{ success: boolean; error?: string }> {
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

      // Apply group settings — best-effort, do not fail the sync if this errors
      try {
        const settingsClient = google.groupssettings({ version: "v1", auth });
        await settingsClient.groups.patch({
          groupUniqueId: groupEmail,
          requestBody: {
            whoCanPostMessage: "ANYONE",
            whoCanViewMembership: "ALL_MEMBERS_CAN_VIEW",
          },
        });
      } catch (settingsErr) {
        console.warn("[google-groups] Failed to apply group settings:", settingsErr);
      }
    }

    // 4. Fetch current Google Group members
    const googleMembersRes = await adminClient.members.list({ groupKey: groupEmail });
    const googleMemberEmails = new Set<string>(
      (googleMembersRes.data.members ?? [])
        .map((m) => m.email?.toLowerCase())
        .filter((e): e is string => Boolean(e))
    );

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

    // 6. Add missing members
    const toAdd = [...portalMemberEmails].filter((e) => !googleMemberEmails.has(e));
    for (const email of toAdd) {
      await adminClient.members.insert({
        groupKey: groupEmail,
        requestBody: { email, role: "MEMBER" },
      });
    }

    // 7. Remove extra members (those in Google but not in portal)
    const toRemove = [...googleMemberEmails].filter((e) => !portalMemberEmails.has(e));
    for (const email of toRemove) {
      await adminClient.members.delete({ groupKey: groupEmail, memberKey: email });
    }

    // 8. Update sync status — success
    await db
      .update(groups)
      .set({
        googleGroupSyncedAt: new Date(),
        googleGroupSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, groupId));

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[google-groups] syncGoogleGroup failed for ${groupId}:`, err);

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
