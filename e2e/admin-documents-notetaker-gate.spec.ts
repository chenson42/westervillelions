import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, userRoles } from "../src/lib/db/schema";

/**
 * Regression coverage for docs/work-log/2026-08-09-governance-document-
 * versioning.md, Phase 5 (qa).
 *
 * src/proxy.ts's protectionRules has no `/^\/admin\/documents/` entry, so
 * any request under /admin/documents falls through to the generic
 * `/^\/admin/` catch-all, which requires FEATURES.ADMIN_DASHBOARD. A
 * `notetaker` (bound ONLY to documents.manage/minutes.manage, deliberately
 * NOT admin.dashboard — see DECISION-076 Ruling 6, drizzle/migrations/
 * 0082_governance_documents_permissions.sql) is bounced to /access-pending
 * on every single visit to /admin/documents*, even though the notetaker
 * role is the exact role this feature was built to let author document
 * versions ("the secretary editing," this work-log's "How it got here" §4).
 * A notetaker-only account can therefore never reach the admin UI to save,
 * adopt, or review a governance document version.
 *
 * This is the SAME failure mode already fixed twice in this codebase for
 * this exact reason: the budget-committee role (v1.55.0, see
 * admin-ledger-budget-committee-gate.spec.ts) and, days before this feature,
 * the notetaker role for /admin/minutes itself (see
 * admin-minutes-notetaker-gate.spec.ts) — in the SAME work-log lineage this
 * feature was split out of. It was not caught in Phase 4 here because every
 * smoke test used the E2E admin account, which bypasses ALL proxy feature
 * checks (proxy.ts: "Admins bypass all feature checks") — never a plain
 * notetaker session. The admin API route itself
 * (GET /api/admin/documents/[slug]/versions) is unaffected — API routes
 * skip proxy.ts entirely and correctly gate on hasFeature(DOCUMENTS_MANAGE)
 * — so this is specifically a missing protectionRules entry, not a missing
 * FEATURES check.
 *
 * Fixture rationale mirrors admin-minutes-notetaker-gate.spec.ts exactly:
 * role creation has no HTTP equivalent in this project (roles are
 * migration-only), so this composes a disposable fixture user bound to the
 * real, already-migrated `notetaker` role via a direct, minimal DB
 * insert/delete. No feature or role definition is created or changed.
 */

const FIXTURE_EMAIL = `qa-documents-notetaker-gate-${Date.now()}@example.test`;
const FIXTURE_PASSWORD = "E2eDocumentsNotetakerGate!2026";

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
      name: "QA Documents Notetaker Gate Fixture",
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

test.describe("a notetaker-only account (documents.manage, no admin.dashboard) reaches /admin/documents", () => {
  test("can load the /admin/documents list directly — regression for missing proxy rule (same class as v1.55.0/budget-committee and the minutes notetaker gate)", async ({
    page,
  }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/documents");

    // Assert — not bounced to /access-pending; the real admin list rendered.
    await expect(page).toHaveURL("/admin/documents");
  });

  test("can load /admin/documents/constitution-bylaws directly", async ({ page }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/documents/constitution-bylaws");

    // Assert
    await expect(page).toHaveURL("/admin/documents/constitution-bylaws");
  });
});

/**
 * Companion coverage: a notetaker gaining access to /admin/documents must
 * NOT be a side effect of a rule that accidentally widened admin access
 * generally. documents.manage must remain scoped to the /admin/documents*
 * prefix only.
 */
test.describe("the same notetaker-only account is still refused elsewhere in /admin", () => {
  test("is bounced to /access-pending from /admin/members — regression for the documents proxy rule accidentally widening admin access", async ({
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
