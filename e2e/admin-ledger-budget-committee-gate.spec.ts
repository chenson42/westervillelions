import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, userRoles } from "../src/lib/db/schema";

/**
 * Regression coverage for docs/work-log/2026-08-05-admin-area-gating.md,
 * "Increment 2 — proxy layer".
 *
 * v1.55.0's first attempt at this bug corrected the admin layout, the
 * header's Admin link, and lifted nav data into ADMIN_NAVIGATION — and was
 * reported fixed. It was not: src/proxy.ts runs BEFORE any of that and had
 * no /admin/ledger rule in its ordered protectionRules list, so any request
 * under /admin/ledger fell through to the /^\/admin/ catch-all requiring
 * FEATURES.ADMIN_DASHBOARD. A budget-committee member holding budget.view/
 * budget.edit/ledger.view — deliberately NOT admin.dashboard — was bounced
 * to /access-pending on every visit to the exact page (Budgeting) she had
 * been given the role to review. This is the third time this area has been
 * "fixed"; this suite exists so the next regression here fails a real test
 * instead of being silently re-shipped and re-reported.
 *
 * Fixture rationale: there is no admin API to create a new role (role
 * creation is migration-only by this project's own convention — see
 * CLAUDE.md, "Permissions Are the Only Gating Mechanism" — /admin/roles has
 * no create action, and /api/admin/roles/[id]/features only grants/revokes
 * features on an EXISTING role id). This suite therefore composes a
 * disposable fixture user from two REAL, already-migrated roles — member
 * (events.view, members.view) + budget_committee (budget.view, budget.edit,
 * ledger.view) — via a direct, minimal DB read (role id lookup by name) and
 * insert/delete of the fixture user + its two role bindings. No feature or
 * role definition is created, changed, or removed; no production/business
 * data (transactions, budgets, members) is touched. This mirrors the
 * fixture discipline already used by ledger-category-management.spec.ts and
 * admin-security.spec.ts, extended for the one seam — role creation — that
 * has no HTTP equivalent in this codebase.
 */

const FIXTURE_EMAIL = `qa-budget-committee-gate-${Date.now()}@example.test`;
const FIXTURE_PASSWORD = "E2eBudgetCommitteeGate!2026";

let fixtureUserId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);

  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  const budgetCommitteeRole = await db.query.roles.findFirst({ where: eq(roles.name, "budget_committee") });
  if (!memberRole || !budgetCommitteeRole) {
    throw new Error(
      "Fixture setup requires the 'member' and 'budget_committee' roles to already exist in the DB — run `pnpm db:migrate` first."
    );
  }

  const [fixtureUser] = await db
    .insert(users)
    .values({
      email: FIXTURE_EMAIL,
      name: "QA Budget Committee Gate Fixture",
      password: passwordHash,
      role: "member",
      isActive: true,
    })
    .returning({ id: users.id });
  fixtureUserId = fixtureUser.id;

  await db.insert(userRoles).values([
    { userId: fixtureUserId, roleId: memberRole.id },
    { userId: fixtureUserId, roleId: budgetCommitteeRole.id },
  ]);
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

test.describe("budget-committee-shaped member reaches the budgeting area", () => {
  test("can load /admin/ledger/budgeting directly — regression for proxy layer admin-area gating", async ({ page }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/ledger/budgeting");

    // Assert — not bounced to /access-pending; the real page rendered.
    await expect(page).toHaveURL("/admin/ledger/budgeting");
    await expect(page.getByRole("heading", { name: "Budget Planning" })).toBeVisible();
  });

  test("the Admin link is visible in the header for this user", async ({ page }) => {
    // Arrange
    await signInAsFixture(page);
    await page.goto("/members");

    // Act / Assert — canAccessAdminArea() admits her (budget.view gates a
    // sidebar item), so the header must show the link even though she is
    // not an admin.dashboard holder.
    await expect(page.getByRole("link", { name: "Admin" }).first()).toBeVisible();
  });

  test("visiting bare /admin never shows the org-wide stats dashboard", async ({ page }) => {
    // Arrange — src/app/(dashboard)/admin/page.tsx has its own redirect to
    // getFirstAccessibleAdminHref() for non-admin.dashboard holders, but
    // that logic is unreachable here: bare "/admin" doesn't match the
    // proxy's /^\/admin\/ledger/ (or any other specific) rule, so it falls
    // through to the /^\/admin/ catch-all, which still requires
    // FEATURES.ADMIN_DASHBOARD and redirects to /access-pending BEFORE
    // admin/page.tsx ever runs. This is an acceptable outcome against the
    // brief's actual bar ("must still be refused or redirect ... confirm
    // she is not dumped on org-wide stats") but it does mean the page's own
    // smart-redirect branch is currently dead code for anyone without
    // admin.dashboard — flagged in the work-log as a follow-up, not fixed
    // here (qa does not write feature code).
    await signInAsFixture(page);

    // Act
    await page.goto("/admin");

    // Assert — refused, and specifically not the stats dashboard.
    await expect(page).toHaveURL("/access-pending");
  });

  test("is still refused a route she has no feature for — /admin/members (lacks members.edit)", async ({ page }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/members");

    // Assert — the widened admin-area gate must not over-grant.
    await expect(page).toHaveURL("/access-pending");
  });

  test("is refused by the page's own gate (not the proxy) for /admin/ledger/settings/categories, which requires ledger.manage", async ({ page }) => {
    // Arrange
    await signInAsFixture(page);

    // Act — the proxy's /admin/ledger rule admits her (she holds
    // ledger.view/budget.view/budget.edit), so this exercises the page's
    // own, finer-grained hasFeature(LEDGER_MANAGE) check.
    await page.goto("/admin/ledger/settings/categories");

    // Assert — graceful redirect back to the Ledger dashboard, not a crash
    // and not /access-pending (the area itself is still hers to be in).
    await expect(page).toHaveURL("/admin/ledger");
  });
});
