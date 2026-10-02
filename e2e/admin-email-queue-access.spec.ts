import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, roleFeatures, features, userRoles, emailQueue } from "../src/lib/db/schema";
import { buildPasswordResetEmailHtml } from "../src/lib/email-compose";

/**
 * B-111 / DECISION-115, Phase 5 (qa). Email Queue access and credential redaction.
 *
 * What only a live session can prove (no unit test sees it): the migration (0110) + the JWT
 * written at sign-in + the derived /admin/email-queue proxy rule + the page's own gate all
 * line up for the SEEDED `treasurer` role, with no `admin` role and no `admin.users`.
 *
 * Fixtures (all disposable, all `example.test`, nothing can be sent):
 *  - treasurer-only: the REAL `treasurer` role, nothing else. Signed in fresh, so its JWT
 *    carries email_queue.manage from migration 0110.
 *  - budget-only: the REAL `budget_committee` role (ledger.view/budget.*, no queue key):
 *    must be refused.
 *  - admin.users-only: a disposable role bound to admin.users alone. TRANSITIONAL: for one
 *    release the queue accepts email_queue.manage OR admin.users (EMAIL_QUEUE_FEATURES), so an
 *    admin whose JWT predates migration 0110 is not bounced. When the follow-up removes
 *    ADMIN_USERS from the gate, this one case is MEANT to flip to /access-pending: update it
 *    in the same change.
 *  - one email_queue row (status blocked_non_production) whose html is built by the REAL
 *    buildPasswordResetEmailHtml() around a fake 64-hex token, so the redaction is checked
 *    against the template the sender uses, not a pasted copy.
 *
 * Does NOT prove: runtime grants made at /admin/permissions, or that other readers of
 * persisted email bodies redact (B-135).
 */

const STAMP = Date.now();
const PASSWORD = "E2eEmailQueueAccess!2026";
const TREASURER_EMAIL = `qa-email-queue-treasurer-${STAMP}@example.test`;
const BUDGET_EMAIL = `qa-email-queue-budget-${STAMP}@example.test`;
const ADMIN_USERS_EMAIL = `qa-email-queue-adminusers-${STAMP}@example.test`;
const FIXTURE_ROLE_NAME = `qa_email_queue_admin_users_only_${STAMP}`;
const ROW_TO = `qa-email-queue-row-${STAMP}@example.test`;
const TOKEN = crypto.randomBytes(32).toString("hex"); // 64 hex chars, like generateResetToken()

const userIds: string[] = [];
let fixtureRoleId: string | undefined;
let queueRowId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const treasurerRole = await db.query.roles.findFirst({ where: eq(roles.name, "treasurer") });
  const budgetRole = await db.query.roles.findFirst({ where: eq(roles.name, "budget_committee") });
  const adminUsersFeature = await db.query.features.findFirst({ where: eq(features.name, "admin.users") });
  const queueFeature = await db.query.features.findFirst({ where: eq(features.name, "email_queue.manage") });
  if (!treasurerRole || !budgetRole || !adminUsersFeature || !queueFeature) {
    throw new Error(
      "Fixture setup requires the treasurer and budget_committee roles and the admin.users and email_queue.manage features — run `pnpm db:migrate` (migration 0110) first.",
    );
  }

  const [fixtureRole] = await db
    .insert(roles)
    .values({ name: FIXTURE_ROLE_NAME, description: "QA fixture — admin.users only" })
    .returning({ id: roles.id });
  fixtureRoleId = fixtureRole.id;
  await db.insert(roleFeatures).values({ roleId: fixtureRoleId, featureId: adminUsersFeature.id });

  const make = async (email: string, name: string, roleId: string) => {
    const [u] = await db
      .insert(users)
      .values({ email, name, password: passwordHash, role: "member", isActive: true })
      .returning({ id: users.id });
    userIds.push(u.id);
    await db.insert(userRoles).values({ userId: u.id, roleId });
  };
  await make(TREASURER_EMAIL, "QA Email Queue Treasurer-Only Fixture", treasurerRole.id);
  await make(BUDGET_EMAIL, "QA Email Queue Budget Fixture", budgetRole.id);
  await make(ADMIN_USERS_EMAIL, "QA Email Queue Admin-Users-Only Fixture", fixtureRoleId);

  const [row] = await db
    .insert(emailQueue)
    .values({
      to: ROW_TO,
      from: "QA <noreply@example.test>",
      subject: `QA reset-link redaction probe ${STAMP}`,
      html: buildPasswordResetEmailHtml(`https://example.test/reset-password?token=${TOKEN}`),
      status: "blocked_non_production",
      attempts: 0,
    })
    .returning({ id: emailQueue.id });
  queueRowId = row.id;
});

test.afterAll(async () => {
  if (queueRowId) await db.delete(emailQueue).where(eq(emailQueue.id, queueRowId));
  for (const id of userIds) {
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  if (fixtureRoleId) {
    await db.delete(roleFeatures).where(eq(roleFeatures.roleId, fixtureRoleId));
    await db.delete(roles).where(eq(roles.id, fixtureRoleId));
  }
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 30000 });
}

async function adminHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(new Set(Array.from(document.querySelectorAll("a[href^='/admin']")).map((a) => a.getAttribute("href") ?? ""))),
  );
}

test.describe("treasurer role alone (no admin role, no admin.users)", () => {
  test("should see Email Queue and Ledger Settings in the sidebar and load /admin/email-queue — regression for the treasurer needing admin.users for the queue", async ({
    page,
  }) => {
    // Arrange
    await signIn(page, TREASURER_EMAIL);

    // Act
    await page.goto("/admin/email-queue");
    await page.waitForLoadState("networkidle");
    const hrefs = await adminHrefs(page);

    // Assert
    expect(new URL(page.url()).pathname).toBe("/admin/email-queue");
    await expect(page.getByRole("heading", { name: "Email Queue" })).toBeVisible();
    expect(hrefs).toContain("/admin/email-queue");
    expect(hrefs).toContain("/admin/ledger/settings");
  });

  test("should NOT see the Approvals link, which needs ledger.approve (board_member)", async ({ page }) => {
    // Arrange
    await signIn(page, TREASURER_EMAIL);

    // Act
    await page.goto("/admin/ledger");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(await adminHrefs(page)).not.toContain("/admin/ledger/approvals");
  });

  test("should be admitted by the retry route (404-style per-id result for an unknown id, not 403)", async ({ page }) => {
    // Arrange
    await signIn(page, TREASURER_EMAIL);

    // Act — an id that matches no row: the gate runs first and nothing is sent.
    const res = await page.request.post("/api/admin/email-queue/retry", {
      data: { ids: ["00000000-0000-0000-0000-000000000000"] },
    });
    const json = await res.json();

    // Assert
    expect(res.status()).toBe(200);
    expect(json.results[0]).toMatchObject({ success: false, error: "Email not found" });
  });

  test("should see the reset-link token hidden in the preview while the stored row keeps the real token — regression for the queue viewer exposing live password-reset links", async ({
    page,
  }) => {
    // Arrange
    await signIn(page, TREASURER_EMAIL);
    await page.goto("/admin/email-queue");
    await page.waitForLoadState("networkidle");

    // Act
    const row = page.locator("tr", { hasText: ROW_TO });
    await row.getByRole("button", { name: "View" }).click();
    const srcdoc = await page.locator("iframe[sandbox]").first().getAttribute("srcdoc");
    const rendered = await page.content();
    const stored = await db.query.emailQueue.findFirst({ where: eq(emailQueue.id, queueRowId!) });

    // Assert — redacted on the way to the browser, untouched in the database.
    expect(srcdoc).toContain("reset-password?token=[hidden]");
    expect(srcdoc).not.toContain(TOKEN);
    expect(rendered).not.toContain(TOKEN);
    expect(stored?.html).toContain(TOKEN);
  });
});

test.describe("accounts without the Email Queue key", () => {
  test("should bounce a budget_committee member from /admin/email-queue to /access-pending and 403 the retry route", async ({
    page,
  }) => {
    // Arrange
    await signIn(page, BUDGET_EMAIL);

    // Act
    await page.goto("/admin/email-queue");
    await page.waitForLoadState("networkidle");
    const res = await page.request.post("/api/admin/email-queue/retry", {
      data: { ids: ["00000000-0000-0000-0000-000000000000"] },
    });

    // Assert
    expect(new URL(page.url()).pathname).toBe("/access-pending");
    expect(res.status()).toBe(403);
  });

  test("should not show the Email Queue link to a budget_committee member", async ({ page }) => {
    // Arrange
    await signIn(page, BUDGET_EMAIL);

    // Act
    await page.goto("/admin/ledger");
    await page.waitForLoadState("networkidle");

    // Assert — the link used to be visible to every admin-area user and then bounced them.
    expect(await adminHrefs(page)).not.toContain("/admin/email-queue");
  });
});

test.describe("transitional: admin.users holder (one release only, DECISION-115)", () => {
  test("should still reach /admin/email-queue through the transitional any-of — flips to /access-pending when ADMIN_USERS is removed from EMAIL_QUEUE_FEATURES", async ({
    page,
  }) => {
    // Arrange
    await signIn(page, ADMIN_USERS_EMAIL);

    // Act
    await page.goto("/admin/email-queue");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(new URL(page.url()).pathname).toBe("/admin/email-queue");
  });
});
