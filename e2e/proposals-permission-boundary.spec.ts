import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { users, roles, userRoles, proposals, proposalDecisions, members } from "../src/lib/db/schema";

/**
 * Regression coverage for docs/work-log/2026-08-09-project-proposal-form.md,
 * Phase 5 (qa).
 *
 * Verifies the permission boundary and enumeration-resistance rules the
 * Phase 3 design doc specifies for /members/proposals and
 * /(dashboard)/admin/proposals, with a REAL non-privileged session (not the
 * admin E2E fixture, which bypasses every proxy feature check) — this
 * project has shipped five separate lockout/leak bugs from assuming a gate
 * worked without testing it this way.
 *
 * Covers:
 *  - A plain `member`-role account (no FEATURES.PROPOSALS_REVIEW) cannot
 *    reach /admin/proposals (redirected to /access-pending).
 *  - The same account gets 403, not a silent 200, from
 *    POST /api/admin/proposals/[id]/decide.
 *  - The same account requesting another member's proposal — by page or by
 *    the PATCH route — gets 404, never 403, so existence isn't leaked
 *    (Phase 1's Adversarial Pass, "Enumeration").
 *  - A `board_member` account (which the 0085_proposals_permissions.sql
 *    migration binds to proposals.review) CAN reach /admin/proposals and
 *    see a submitted proposal there.
 *
 * Fixture rationale mirrors admin-minutes-notetaker-gate.spec.ts /
 * admin-subscriptions-page-gate.spec.ts: a disposable `member`-role user for
 * the negative checks, a disposable `board_member`-role user for the
 * positive check, and a disposable proposal owned by neither, all via
 * direct DB insert/delete — no HTTP-only path exists to create a role
 * binding or seed a submitted proposal for another user.
 */

const MEMBER_EMAIL = `qa-proposals-member-gate-${Date.now()}@example.test`;
const REVIEWER_EMAIL = `qa-proposals-reviewer-gate-${Date.now()}@example.test`;
const PASSWORD = "E2eProposalsGate!2026";

let memberUserId: string | undefined;
let memberMemberId: string | undefined;
let reviewerUserId: string | undefined;
let otherOwnerUserId: string | undefined;
let otherProposalId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  const boardMemberRole = await db.query.roles.findFirst({ where: eq(roles.name, "board_member") });
  if (!memberRole || !boardMemberRole) {
    throw new Error("Fixture setup requires the 'member' and 'board_member' roles to already exist — run `pnpm db:migrate` first.");
  }

  // Linked to a real member row — matches the realistic shape of a plain
  // member session (an unlinked account short-circuits PATCH's own
  // memberId gate to a uniform 403 before it ever reaches the ownership
  // check, which would test the wrong code path here).
  const [memberRow] = await db
    .insert(members)
    .values({ firstName: "QA", lastName: "Proposals Gate Fixture", email: MEMBER_EMAIL, isActive: true })
    .returning({ id: members.id });
  memberMemberId = memberRow.id;

  const [memberUser] = await db
    .insert(users)
    .values({ email: MEMBER_EMAIL, name: "QA Proposals Member Gate Fixture", password: passwordHash, role: "member", isActive: true, memberId: memberMemberId })
    .returning({ id: users.id });
  memberUserId = memberUser.id;
  await db.insert(userRoles).values([{ userId: memberUserId, roleId: memberRole.id }]);

  const [reviewerUser] = await db
    .insert(users)
    .values({ email: REVIEWER_EMAIL, name: "QA Proposals Reviewer Gate Fixture", password: passwordHash, role: "board_member", isActive: true })
    .returning({ id: users.id });
  reviewerUserId = reviewerUser.id;
  await db.insert(userRoles).values([{ userId: reviewerUserId, roleId: boardMemberRole.id }]);

  // A proposal owned by a third, unrelated user — the target for the
  // enumeration-resistance checks below.
  const [otherOwner] = await db
    .insert(users)
    .values({ email: `qa-proposals-other-owner-${Date.now()}@example.test`, name: "QA Proposals Other Owner Fixture", password: passwordHash, role: "member", isActive: true })
    .returning({ id: users.id, email: users.email });
  otherOwnerUserId = otherOwner.id;

  const [otherProposal] = await db
    .insert(proposals)
    .values({
      proposerUserId: otherOwnerUserId,
      proposerNameSnapshot: "QA Proposals Other Owner Fixture",
      proposerEmailSnapshot: otherOwner.email,
      status: "submitted",
      projectName: "QA Gate Fixture Proposal",
      type: "service_project",
      needDescription: "Enumeration-resistance fixture for the permission-boundary e2e suite.",
      chairName: "Not yet identified",
      moneyNeeded: "no",
      submittedAt: new Date(),
    })
    .returning({ id: proposals.id });
  otherProposalId = otherProposal.id;

  await db.insert(proposalDecisions).values({
    proposalId: otherProposalId,
    status: "submitted",
    decidedByUserId: otherOwnerUserId,
  });
});

test.afterAll(async () => {
  if (otherProposalId) {
    await db.delete(proposalDecisions).where(eq(proposalDecisions.proposalId, otherProposalId));
    await db.delete(proposals).where(eq(proposals.id, otherProposalId));
  }
  for (const id of [memberUserId, reviewerUserId, otherOwnerUserId]) {
    if (id) {
      await db.delete(userRoles).where(eq(userRoles.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
  }
  if (memberMemberId) {
    await db.delete(members).where(eq(members.id, memberMemberId));
  }
});

async function signIn(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.goto("/signin");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15000 });
}

test.describe("a plain member (no proposals.review) at the proposals admin/API boundary", () => {
  test("must not reach /admin/proposals — redirected to /access-pending", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);

    // Act
    await page.goto("/admin/proposals");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).toContain("/access-pending");
  });

  test("must get 403, not a silent 200, from POST /api/admin/proposals/[id]/decide — regression for a missing hasFeature() gate", async ({ page, request }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.post(`/api/admin/proposals/${otherProposalId}/decide`, {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { status: "under_review" },
    });

    // Assert
    expect(res.status()).toBe(403);
  });

  test("requesting another member's proposal detail page gets 404, not 403 — regression for existence-leaking enumeration", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);

    // Act
    const res = await page.goto(`/members/proposals/${otherProposalId}`);

    // Assert
    expect(res?.status()).toBe(404);
  });

  test("PATCHing another member's proposal gets 404, not 403 — regression for existence-leaking enumeration", async ({ page, request }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.patch(`/api/members/proposals/${otherProposalId}`, {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { projectName: "hijacked by e2e fixture" },
    });

    // Assert
    expect(res.status()).toBe(404);
  });
});

test.describe("a board_member (holds proposals.review) at the proposals admin boundary", () => {
  test("reaches /admin/proposals and sees a submitted proposal", async ({ page }) => {
    // Arrange
    await signIn(page, REVIEWER_EMAIL);

    // Act
    await page.goto("/admin/proposals");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).toContain("/admin/proposals");
    await expect(page.getByText("QA Gate Fixture Proposal")).toBeVisible();
  });
});
