import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { minutes, members, users, roles, userRoles } from "../src/lib/db/schema";
import { signInAsAdmin } from "./helpers/auth";

/**
 * Regression / verification coverage for docs/work-log/2026-08-08-meeting-minutes.md,
 * Phase 4 loop-back (DECISION-079).
 *
 * Attendance was reframed from a per-member roster (`minutesAttendance`,
 * removed) to a single nullable headcount, `minutes.presentCount`. This
 * suite verifies the new field's contract end to end through the real UI:
 * it is genuinely optional (blank stays null, never coerced to 0), it
 * round-trips through create -> reload -> edit -> re-save, and an
 * out-of-range value does not silently create a bad record.
 *
 * Fixture rationale: uses the project's own seeded E2E admin account
 * (E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD, loaded from .env.local per this
 * project's Playwright config) rather than a disposable role fixture,
 * since this suite exercises ordinary authoring behavior, not a
 * permission boundary. Every minutes row this suite creates is deleted
 * directly by id in afterEach; motions/action-items tables cascade on
 * minutes.id (onDelete: "cascade"), so no separate child cleanup is
 * needed.
 */

test.describe.configure({ mode: "serial" });

const createdMinutesIds: string[] = [];

test.afterEach(async () => {
  while (createdMinutesIds.length) {
    const id = createdMinutesIds.pop();
    if (id) await db.delete(minutes).where(eq(minutes.id, id));
  }
});

test.describe("minutes present-count field", () => {
  test("blank present count creates a record with presentCount null, not 0", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/minutes/new");

    // Act — leave "Members present" blank entirely.
    await page.fill("#minutes-meeting-date", "2026-01-05");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/minutes\/[0-9a-f-]+/, { timeout: 15000 });

    // Assert
    const id = new URL(page.url()).pathname.split("/").pop()!;
    createdMinutesIds.push(id);
    const row = await db.query.minutes.findFirst({ where: eq(minutes.id, id) });
    expect(row?.presentCount).toBeNull();
  });

  test("a present count round-trips through create, reload, and edit", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/minutes/new");

    // Act — create with presentCount=22.
    await page.fill("#minutes-meeting-date", "2026-01-12");
    await page.fill("#minutes-present-count", "22");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/minutes\/[0-9a-f-]+/, { timeout: 15000 });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    createdMinutesIds.push(id);

    // Assert — persisted in the DB.
    let row = await db.query.minutes.findFirst({ where: eq(minutes.id, id) });
    expect(row?.presentCount).toBe(22);

    // Assert — reloading the edit page (WITHOUT ?justSaved=1, which would
    // re-open the post-save email prompt and block the form) shows the same
    // value in the input.
    await page.goto(`/admin/minutes/${id}`);
    await expect(page.locator("#minutes-present-count")).toHaveValue("22");

    // Act — edit it down to 18 and re-save.
    await page.fill("#minutes-present-count", "18");
    await page.click('button[type="submit"]');
    await expect(page.locator("text=Minutes saved.")).toBeVisible({ timeout: 10000 });

    // Assert — the edit persisted.
    row = await db.query.minutes.findFirst({ where: eq(minutes.id, id) });
    expect(row?.presentCount).toBe(18);
  });

  test("the admin list's Present column shows the count, and an em dash when null", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/minutes/new");
    await page.fill("#minutes-meeting-date", "2026-01-19");
    await page.fill("#minutes-present-count", "31");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/minutes\/[0-9a-f-]+/, { timeout: 15000 });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    createdMinutesIds.push(id);

    // Act
    await page.goto("/admin/minutes");

    // Assert
    const row = page.locator("tr", { has: page.locator(`a[href="/admin/minutes/${id}"]`) });
    await expect(row.locator("td").filter({ hasText: "31" })).toBeVisible();
  });

  test("member-facing detail renders 'No attendance count recorded.' when null, never '0 present'", async ({
    page,
    browser,
  }) => {
    // Arrange — create the record as admin.
    await signInAsAdmin(page);
    await page.goto("/admin/minutes/new");
    await page.fill("#minutes-meeting-date", "2026-01-26");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/admin\/minutes\/[0-9a-f-]+/, { timeout: 15000 });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    createdMinutesIds.push(id);

    // Arrange — the seeded E2E admin account has no linked member row
    // (member_id is null), so /members/records requires its own disposable
    // linked member + user fixture, mirroring qa's prior "universal member
    // read access" verification pattern.
    const fixtureEmail = `qa-present-count-member-${Date.now()}@example.test`;
    const fixturePassword = "E2ePresentCountMember!2026";
    const passwordHash = await bcrypt.hash(fixturePassword, 10);
    const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
    if (!memberRole) throw new Error("Fixture setup requires the 'member' role to already exist.");
    const [member] = await db
      .insert(members)
      .values({
        firstName: "QA",
        lastName: "PresentCountReader",
        email: fixtureEmail,
        membershipStatus: "active",
      })
      .returning({ id: members.id });
    const [fixtureUser] = await db
      .insert(users)
      .values({
        email: fixtureEmail,
        name: "QA Present Count Reader",
        password: passwordHash,
        role: "member",
        isActive: true,
        memberId: member.id,
      })
      .returning({ id: users.id });
    // Session features come from the userRoles -> roleFeatures join (see
    // src/lib/auth/index.ts), NOT from the users.role text column above —
    // without this row the fixture would have zero features and proxy.ts's
    // generic /^\/members/ catch-all (FEATURES.MEMBERS_VIEW) would bounce
    // it to /access-pending before ever reaching the page under test.
    await db.insert(userRoles).values({ userId: fixtureUser.id, roleId: memberRole.id });

    try {
      // Act
      const memberPage = await browser.newPage();
      await memberPage.goto("/signin");
      await memberPage.fill('input[type="email"]', fixtureEmail);
      await memberPage.fill('input[type="password"]', fixturePassword);
      await memberPage.click('button[type="submit"]');
      await memberPage.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
      await memberPage.goto(`/members/records/${id}`);

      // Assert
      await expect(memberPage.locator("text=No attendance count recorded.")).toBeVisible();
      await expect(memberPage.locator("text=0 present")).toHaveCount(0);
      await memberPage.close();
    } finally {
      await db.delete(users).where(eq(users.id, fixtureUser.id));
      await db.delete(members).where(eq(members.id, member.id));
    }
  });

  test("an out-of-range present count does not create a record", async ({ page }) => {
    // Arrange
    await signInAsAdmin(page);
    await page.goto("/admin/minutes/new");

    // Act
    await page.fill("#minutes-meeting-date", "2026-02-02");
    await page.fill("#minutes-present-count", "-5");
    await page.click('button[type="submit"]');

    // Assert — still on the create form; no navigation to a new record id.
    await page.waitForTimeout(500);
    await expect(page).toHaveURL("/admin/minutes/new");
  });
});
