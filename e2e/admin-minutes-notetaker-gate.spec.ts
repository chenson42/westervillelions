import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, userRoles } from "../src/lib/db/schema";

/**
 * Regression coverage for docs/work-log/2026-08-08-meeting-minutes.md,
 * Phase 5 (qa).
 *
 * src/proxy.ts's protectionRules has no `/^\/admin\/minutes/` entry, so any
 * request under /admin/minutes falls through to the generic `/^\/admin/`
 * catch-all, which requires FEATURES.ADMIN_DASHBOARD. A `notetaker` (bound
 * ONLY to minutes.manage, deliberately not admin.dashboard — see
 * DECISION-074/077, drizzle/migrations/0080_minutes_permissions.sql) is
 * bounced to /access-pending on every single visit to /admin/minutes*,
 * including /admin/minutes/new — meaning a notetaker who is not also an
 * admin can never create or edit a single minutes record. This is the
 * SAME failure mode already fixed once in this codebase for the Ledger's
 * budget-committee role (see admin-ledger-budget-committee-gate.spec.ts and
 * its own docstring — v1.55.0's admin-layout fix missed this exact layer).
 * It was not caught in Phase 4 because every smoke test used either the
 * E2E admin account (which bypasses ALL proxy feature checks — proxy.ts
 * line ~46, "Admins bypass all feature checks") or unauthenticated
 * requests — never a plain notetaker session.
 *
 * Fixture rationale mirrors admin-ledger-budget-committee-gate.spec.ts
 * exactly: role creation has no HTTP equivalent in this project (roles are
 * migration-only), so this composes a disposable fixture user bound to the
 * real, already-migrated `notetaker` role via a direct, minimal DB
 * insert/delete. No feature or role definition is created or changed.
 */

const FIXTURE_EMAIL = `qa-notetaker-gate-${Date.now()}@example.test`;
const FIXTURE_PASSWORD = "E2eNotetakerGate!2026";

let fixtureUserId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);

  const notetakerRole = await db.query.roles.findFirst({ where: eq(roles.name, "notetaker") });
  if (!notetakerRole) {
    throw new Error("Fixture setup requires the 'notetaker' role to already exist — run `pnpm db:migrate` first.");
  }

  const [fixtureUser] = await db
    .insert(users)
    .values({
      email: FIXTURE_EMAIL,
      name: "QA Notetaker Gate Fixture",
      password: passwordHash,
      role: "member",
      isActive: true,
    })
    .returning({ id: users.id });
  fixtureUserId = fixtureUser.id;

  await db.insert(userRoles).values([{ userId: fixtureUserId, roleId: notetakerRole.id }]);
});

test.afterAll(async () => {
  if (!fixtureUserId) return;
  await db.delete(userRoles).where(eq(userRoles.userId, fixtureUserId));
  await db.delete(users).where(eq(users.id, fixtureUserId));
});

async function signInAsFixture(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', FIXTURE_EMAIL);
  await page.fill('input[type="password"]', FIXTURE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
}

test.describe("a notetaker-only account (minutes.manage, no admin.dashboard) reaches /admin/minutes", () => {
  test("can load /admin/minutes/new directly — regression for missing proxy rule (proxy layer admin-area gating, same class as v1.55.0/budget-committee)", async ({
    page,
  }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/minutes/new");

    // Assert — not bounced to /access-pending; the real create form rendered.
    await expect(page).toHaveURL("/admin/minutes/new");
    await expect(page.locator("#minutes-meeting-date")).toBeVisible();
  });

  test("can load the /admin/minutes list directly", async ({ page }) => {
    await signInAsFixture(page);

    await page.goto("/admin/minutes");

    await expect(page).toHaveURL("/admin/minutes");
  });
});

/**
 * Companion coverage for the 2026-08-09 re-verification brief: a notetaker
 * gaining access to /admin/minutes must NOT be a side effect of a rule that
 * accidentally widened admin access generally. minutes.manage/minutes.delete
 * must remain scoped to the /admin/minutes* prefix only.
 */
test.describe("the same notetaker-only account is still refused elsewhere in /admin", () => {
  test("is bounced to /access-pending from /admin/members — regression for the minutes proxy rule accidentally widening admin access", async ({
    page,
  }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/members");

    // Assert
    await expect(page).toHaveURL("/access-pending");
  });

  test("is bounced to /access-pending from /admin (dashboard root)", async ({ page }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin");

    // Assert
    await expect(page).toHaveURL("/access-pending");
  });
});
