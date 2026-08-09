import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, userRoles, features, roleFeatures } from "../src/lib/db/schema";

/**
 * Regression coverage for the Phase 5 re-verification of
 * docs/work-log/2026-08-09-governance-document-versioning.md's Phase 4
 * loop-back (DECISION-082, getAdminProtectionRules()).
 *
 * DECISION-082 turned src/proxy.ts's admin-area admission rules into a
 * derivation from ADMIN_NAVIGATION. As a documented, deliberate side effect,
 * 11 admin areas that previously fell to the ADMIN_DASHBOARD catch-all are
 * now admitted on their own narrower nav-declared feature(s) — including
 * "subscriptions" (segment /admin/subscriptions*, admitted by
 * FEATURES.CONTACT_VIEW, per the "Newsletter" nav item's requiredFeature).
 * The work-log's own audit claims this is safe because "every one of those
 * pages already enforces its own hasFeature() check at the page level" —
 * and names dues/events/contact/security as the pages it actually
 * spot-checked. It did not check subscriptions, and the claim is false for
 * it: src/app/(dashboard)/admin/subscriptions/page.tsx performs an auth()
 * check only — no hasFeature() call of any kind — so the ADMIN_DASHBOARD
 * catch-all it fell to *before* this refactor was the only thing standing
 * between a low-privilege account and the full newsletter-subscriber PII
 * table (name + email for every subscriber). After this refactor, that
 * catch-all is gone for this area and nothing replaced it at the page
 * level; the proxy's own CONTACT_VIEW requirement is the sole remaining
 * gate on this bulk-PII page, contrary to the pattern every sibling admin
 * page in this codebase follows (dues, events, announcements, testimonials,
 * programs, contact, suggestions, security, members, membership all check
 * their own feature server-side, independent of the proxy).
 *
 * Confirmed live against dev Postgres before writing this spec: a
 * disposable account holding ONLY contact.view (no admin.dashboard) loads
 * /admin/subscriptions with a 200 and the rendered HTML contains real
 * subscriber email addresses.
 *
 * Fixture rationale: there is no role in this project's seed data that
 * holds contact.view without also holding admin.dashboard (only `admin`
 * and `board_member` hold contact.view today, and both already hold
 * admin.dashboard) — so, unlike the notetaker/budget-committee gate specs,
 * this scenario cannot be composed purely from existing role_features rows.
 * This suite temporarily grants contact.view to the `volunteer` role (which
 * otherwise holds only events.view) for the duration of the test and
 * removes exactly that grant afterward — recording first whether the grant
 * already existed, so cleanup never deletes a binding this suite didn't
 * create itself. No role or feature definition is created, changed, or
 * removed.
 */

const FIXTURE_EMAIL = `qa-subscriptions-gate-${Date.now()}@example.test`;
const FIXTURE_PASSWORD = "E2eSubscriptionsGate!2026";

let fixtureUserId: string | undefined;
let grantedContactViewToVolunteer = false;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 10);

  const volunteerRole = await db.query.roles.findFirst({ where: eq(roles.name, "volunteer") });
  const contactViewFeature = await db.query.features.findFirst({ where: eq(features.name, "contact.view") });
  if (!volunteerRole || !contactViewFeature) {
    throw new Error("Fixture setup requires the 'volunteer' role and 'contact.view' feature to already exist — run `pnpm db:migrate` first.");
  }

  const existingGrant = await db.query.roleFeatures.findFirst({
    where: and(eq(roleFeatures.roleId, volunteerRole.id), eq(roleFeatures.featureId, contactViewFeature.id)),
  });
  if (!existingGrant) {
    await db.insert(roleFeatures).values({ roleId: volunteerRole.id, featureId: contactViewFeature.id });
    grantedContactViewToVolunteer = true;
  }

  const [fixtureUser] = await db
    .insert(users)
    .values({
      email: FIXTURE_EMAIL,
      name: "QA Subscriptions Gate Fixture",
      password: passwordHash,
      role: "member",
      isActive: true,
    })
    .returning({ id: users.id });
  fixtureUserId = fixtureUser.id;

  await db.insert(userRoles).values([{ userId: fixtureUserId, roleId: volunteerRole.id }]);
});

test.afterAll(async () => {
  if (fixtureUserId) {
    await db.delete(userRoles).where(eq(userRoles.userId, fixtureUserId));
    await db.delete(users).where(eq(users.id, fixtureUserId));
  }

  if (grantedContactViewToVolunteer) {
    const volunteerRole = await db.query.roles.findFirst({ where: eq(roles.name, "volunteer") });
    const contactViewFeature = await db.query.features.findFirst({ where: eq(features.name, "contact.view") });
    if (volunteerRole && contactViewFeature) {
      await db
        .delete(roleFeatures)
        .where(and(eq(roleFeatures.roleId, volunteerRole.id), eq(roleFeatures.featureId, contactViewFeature.id)));
    }
  }
});

async function signInAsFixture(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', FIXTURE_EMAIL);
  await page.fill('input[type="password"]', FIXTURE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
}

test.describe("a contact.view-only account (no admin.dashboard) reaches /admin/subscriptions", () => {
  test("must not see subscriber PII without the page enforcing its own feature check — regression for the missing page-level gate DECISION-082's safety claim overlooked", async ({
    page,
  }) => {
    // Arrange
    await signInAsFixture(page);

    // Act
    await page.goto("/admin/subscriptions");

    // Assert — the page must perform its own feature check, matching every
    // sibling admin page's pattern (dues, events, announcements, contact,
    // security, members, membership all redirect a non-holder server-side),
    // rather than relying solely on the proxy layer to protect a bulk-PII
    // table. This fails today: the page performs no feature check at all
    // and renders the full subscriber list — real names and email
    // addresses — to any account the proxy admits.
    await expect(page.getByRole("heading", { name: "Newsletter Subscribers" })).not.toBeVisible();
  });
});
