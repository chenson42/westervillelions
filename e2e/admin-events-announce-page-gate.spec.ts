import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, roleFeatures, features, userRoles, events } from "../src/lib/db/schema";

/**
 * Regression coverage for docs/work-log/2026-09-04-event-announcement-emails.md,
 * Phase 5 (qa).
 *
 * Event Announcement Emails deliberately gates sending on a NEW, NARROWER key
 * (FEATURES.EVENTS_ANNOUNCE) than the general FEATURES.EVENTS_EDIT — bulk
 * email to every active member's inbox is a materially different trust level
 * than editing an event's title/date (Phase 1 User Decision 1, Phase 2's
 * architectural note). Every role that currently holds events.edit
 * (admin, board_member) ALSO holds events.announce, so a happy-path click-
 * through can never surface a mis-wired gate — this was flagged TWICE in the
 * work-log (Phase 2 and Phase 3) as something only a live request against a
 * deliberately under-privileged account can catch, because:
 *
 *   - src/proxy.ts's derived /admin/events* protection rule accepts EITHER
 *     EVENTS_EDIT or EVENTS_ANNOUNCE (getAdminProtectionRules() ORs the
 *     Events nav item's widened requiredFeature array — see
 *     src/proxy.ts:94's `.some(...)`), so an EVENTS_EDIT-only account clears
 *     the proxy and reaches the page/route layer regardless.
 *   - The nested-page gate test (admin-page-feature-gates.test.ts) only
 *     asserts *some* hasFeature()/redirect pair exists on announce/page.tsx —
 *     it would pass just as happily if the page were mistakenly gated on
 *     EVENTS_EDIT instead of EVENTS_ANNOUNCE.
 *
 * So the only real proof is a session that holds events.edit but NOT
 * events.announce. No shipped role has that shape (admin and board_member
 * both hold both), so this composes a disposable fixture role bound to ONLY
 * events.edit via direct DB insert/delete — same rationale as
 * admin-documents-notetaker-gate.spec.ts and proposals-permission-boundary.spec.ts
 * (role creation has no HTTP equivalent in this project).
 */

const EDITOR_EMAIL = `qa-events-announce-editor-only-gate-${Date.now()}@example.test`;
const MEMBER_EMAIL = `qa-events-announce-plain-member-gate-${Date.now()}@example.test`;
const PASSWORD = "E2eEventsAnnounceGate!2026";
const FIXTURE_ROLE_NAME = `qa_events_edit_only_fixture_${Date.now()}`;

let fixtureRoleId: string | undefined;
let editorUserId: string | undefined;
let memberUserId: string | undefined;
let fixtureEventId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const eventsEditFeature = await db.query.features.findFirst({
    where: eq(features.name, "events.edit"),
  });
  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  if (!eventsEditFeature || !memberRole) {
    throw new Error(
      "Fixture setup requires the 'events.edit' feature and 'member' role to already exist — run `pnpm db:migrate` first.",
    );
  }

  // No shipped role holds events.edit without events.announce (admin and
  // board_member hold both) — compose a disposable one for this negative
  // check only. Cascades clean up role_features/user_roles on delete.
  const [fixtureRole] = await db
    .insert(roles)
    .values({ name: FIXTURE_ROLE_NAME, description: "QA fixture — events.edit only, no events.announce" })
    .returning({ id: roles.id });
  fixtureRoleId = fixtureRole.id;
  await db.insert(roleFeatures).values({ roleId: fixtureRoleId, featureId: eventsEditFeature.id });

  const [editorUser] = await db
    .insert(users)
    .values({
      email: EDITOR_EMAIL,
      name: "QA Events Announce Editor-Only Gate Fixture",
      password: passwordHash,
      role: "member",
      isActive: true,
    })
    .returning({ id: users.id });
  editorUserId = editorUser.id;
  await db.insert(userRoles).values({ userId: editorUserId, roleId: fixtureRoleId });

  const [memberUser] = await db
    .insert(users)
    .values({
      email: MEMBER_EMAIL,
      name: "QA Events Announce Plain Member Gate Fixture",
      password: passwordHash,
      role: "member",
      isActive: true,
    })
    .returning({ id: users.id });
  memberUserId = memberUser.id;
  await db.insert(userRoles).values({ userId: memberUserId, roleId: memberRole.id });

  // A real event so the edit-page "Announce" link visibility check and the
  // announce-page redirect both exercise a genuine record, not a 404.
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const wallClock = future.toISOString().slice(0, 19).replace("T", " ");
  const [fixtureEvent] = await db
    .insert(events)
    .values({
      title: "QA Events Announce Gate Fixture Event",
      startDate: wallClock,
      isPublic: false,
      isRecurring: false,
    })
    .returning({ id: events.id });
  fixtureEventId = fixtureEvent.id;
});

test.afterAll(async () => {
  if (fixtureEventId) {
    await db.delete(events).where(eq(events.id, fixtureEventId));
  }
  for (const id of [editorUserId, memberUserId]) {
    if (id) {
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  if (fixtureRoleId) {
    await db.delete(roleFeatures).where(eq(roleFeatures.roleId, fixtureRoleId));
    await db.delete(roles).where(eq(roles.id, fixtureRoleId));
  }
});

async function signIn(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
}

test.describe("an events.edit-only account (no events.announce) at the announce boundary", () => {
  test("does not see the Announce link on the event's admin edit page", async ({ page }) => {
    // Arrange
    await signIn(page, EDITOR_EMAIL);

    // Act
    await page.goto(`/admin/events/${fixtureEventId}`);
    await page.waitForLoadState("networkidle");

    // Assert — the editor CAN reach the edit page itself (events.edit)...
    expect(page.url()).toContain(`/admin/events/${fixtureEventId}`);
    // ...but must not see a live link into the announce flow.
    await expect(page.getByRole("link", { name: /announce/i })).toHaveCount(0);
  });

  test("is redirected off /admin/events/[id]/announce — regression for the Phase 2/3-flagged 'wrong key' risk", async ({
    page,
  }) => {
    // Arrange
    await signIn(page, EDITOR_EMAIL);

    // Act
    await page.goto(`/admin/events/${fixtureEventId}/announce`);
    await page.waitForLoadState("networkidle");

    // Assert — proxy.ts's OR'd rule would let this account through; only the
    // page's own hasFeature(EVENTS_ANNOUNCE) check catches it.
    expect(page.url()).not.toContain("/announce");
  });

  test("gets 403, not a silent 200, from GET /api/admin/events/[id]/announce", async ({ page, request }) => {
    // Arrange
    await signIn(page, EDITOR_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.get(`/api/admin/events/${fixtureEventId}/announce`, {
      headers: { cookie: cookieHeader },
    });

    // Assert
    expect(res.status()).toBe(403);
  });

  test("gets 403, not a silent 200, from POST /api/admin/events/[id]/announce — an events.edit-only account must never be able to send", async ({
    page,
    request,
  }) => {
    // Arrange
    await signIn(page, EDITOR_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.post(`/api/admin/events/${fixtureEventId}/announce`, {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { scope: "occurrence", memberIds: [] },
    });

    // Assert
    expect(res.status()).toBe(403);
  });
});

test.describe("a plain member (no events.edit, no events.announce) at the announce boundary", () => {
  test("is bounced to /access-pending from /admin/events entirely", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);

    // Act
    await page.goto("/admin/events");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).toContain("/access-pending");
  });

  test("is redirected off /admin/events/[id]/announce directly", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);

    // Act
    await page.goto(`/admin/events/${fixtureEventId}/announce`);
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).not.toContain("/announce");
  });

  test("gets 401/403, never a silent 200, from POST /api/admin/events/[id]/announce", async ({ page, request }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.post(`/api/admin/events/${fixtureEventId}/announce`, {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { scope: "occurrence", memberIds: [] },
    });

    // Assert
    expect([401, 403]).toContain(res.status());
  });
});
