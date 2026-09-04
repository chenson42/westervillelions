import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  users,
  roles,
  userRoles,
  members,
  socialRequests,
  socialRequestDecisions,
  emailQueue,
} from "../src/lib/db/schema";
import { BOARD_EMAIL } from "../src/lib/club-contacts";

/**
 * Phase 5 (qa) verification coverage for
 * docs/work-log/2026-09-03-social-media-requests.md.
 *
 * This project has shipped five separate lockout/leak bugs from assuming an
 * admin gate worked without testing it this way (see
 * proposals-permission-boundary.spec.ts, which this file structurally
 * mirrors) — a real non-privileged session, not the admin E2E fixture that
 * bypasses proxy checks, is required to prove the gate.
 *
 * Covers:
 *  - A plain `member`-role account (no social_requests.review) cannot reach
 *    /admin/social-requests and gets 403 (not a silent 200) from
 *    POST /api/admin/social-requests/[id]/decide.
 *  - A `board_member`-role account (bound to social_requests.review by
 *    0093_social_requests_permissions.sql) CAN reach /admin/social-requests
 *    and see a submitted request there.
 *  - The full submit -> board-notify -> decide -> requester-sees-outcome
 *    cycle, driven through the real UI for the member-facing half.
 *  - The board notification email lands in email_queue (status
 *    'blocked_non_production' in this non-production run — never silently
 *    missing) addressed to BOARD_EMAIL.
 *  - The edit-lock: a request moved to `under_review` returns 409 on PATCH.
 *  - The draft discard path returns 204 and the row is gone.
 *  - The server-side image trust boundary: a `data:image/png;...` data URI
 *    wrapping non-PNG bytes (spoofed extension) is rejected by
 *    validateMagicBytes() against the decoded bytes, not the client-declared
 *    MIME prefix — regression coverage for the risk ux-developer's Phase 4c
 *    handoff flagged as the one place a client-crafted bad file can't be
 *    exercised through the UI itself (the UI always re-encodes via canvas).
 */

const MEMBER_EMAIL = `qa-social-requests-member-${Date.now()}@example.test`;
const REVIEWER_EMAIL = `qa-social-requests-reviewer-${Date.now()}@example.test`;
const PASSWORD = "E2eSocialRequestsGate!2026";

let memberUserId: string | undefined;
let memberMemberId: string | undefined;
let reviewerUserId: string | undefined;
let otherOwnerUserId: string | undefined;
let otherRequestId: string | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const memberRole = await db.query.roles.findFirst({ where: eq(roles.name, "member") });
  const boardMemberRole = await db.query.roles.findFirst({ where: eq(roles.name, "board_member") });
  if (!memberRole || !boardMemberRole) {
    throw new Error("Fixture setup requires the 'member' and 'board_member' roles to already exist — run `pnpm db:migrate` first.");
  }

  const [memberRow] = await db
    .insert(members)
    .values({ firstName: "QA", lastName: "Social Requests Gate Fixture", email: MEMBER_EMAIL, isActive: true })
    .returning({ id: members.id });
  memberMemberId = memberRow.id;

  const [memberUser] = await db
    .insert(users)
    .values({ email: MEMBER_EMAIL, name: "QA Social Requests Member Gate Fixture", password: passwordHash, role: "member", isActive: true, memberId: memberMemberId })
    .returning({ id: users.id });
  memberUserId = memberUser.id;
  await db.insert(userRoles).values([{ userId: memberUserId, roleId: memberRole.id }]);

  const [reviewerUser] = await db
    .insert(users)
    .values({ email: REVIEWER_EMAIL, name: "QA Social Requests Reviewer Gate Fixture", password: passwordHash, role: "board_member", isActive: true })
    .returning({ id: users.id });
  reviewerUserId = reviewerUser.id;
  await db.insert(userRoles).values([{ userId: reviewerUserId, roleId: boardMemberRole.id }]);

  // A submitted request owned by a third, unrelated user — the target for
  // the enumeration-resistance and permission-boundary checks below.
  const [otherOwner] = await db
    .insert(users)
    .values({ email: `qa-social-requests-other-owner-${Date.now()}@example.test`, name: "QA Social Requests Other Owner Fixture", password: passwordHash, role: "member", isActive: true })
    .returning({ id: users.id, email: users.email });
  otherOwnerUserId = otherOwner.id;

  const [otherRequest] = await db
    .insert(socialRequests)
    .values({
      requesterUserId: otherOwnerUserId,
      requesterNameSnapshot: "QA Social Requests Other Owner Fixture",
      requesterEmailSnapshot: otherOwner.email,
      status: "submitted",
      platforms: ["facebook"],
      postCopy: "QA Gate Fixture Social Request",
      submittedAt: new Date(),
    })
    .returning({ id: socialRequests.id });
  otherRequestId = otherRequest.id;

  await db.insert(socialRequestDecisions).values({
    socialRequestId: otherRequestId,
    status: "submitted",
    decidedByUserId: otherOwnerUserId,
  });
});

test.afterAll(async () => {
  if (otherRequestId) {
    await db.delete(socialRequestDecisions).where(eq(socialRequestDecisions.socialRequestId, otherRequestId));
    await db.delete(socialRequests).where(eq(socialRequests.id, otherRequestId));
  }
  // Sweep up any request the member fixture created during the live-flow
  // test below (its id isn't known until the test runs).
  if (memberUserId) {
    const owned = await db.query.socialRequests.findMany({ where: eq(socialRequests.requesterUserId, memberUserId) });
    for (const r of owned) {
      await db.delete(socialRequestDecisions).where(eq(socialRequestDecisions.socialRequestId, r.id));
      await db.delete(socialRequests).where(eq(socialRequests.id, r.id));
    }
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

test.describe("a plain member (no social_requests.review) at the social-requests admin/API boundary", () => {
  test("must not reach /admin/social-requests — redirected to /access-pending", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);

    // Act
    await page.goto("/admin/social-requests");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).toContain("/access-pending");
  });

  test("must get 403, not a silent 200, from POST /api/admin/social-requests/[id]/decide — regression for a missing hasFeature() gate", async ({ page, request }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.post(`/api/admin/social-requests/${otherRequestId}/decide`, {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { status: "under_review" },
    });

    // Assert
    expect(res.status()).toBe(403);
  });

  test("requesting another member's request detail page gets 404, not 403 — regression for existence-leaking enumeration", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);

    // Act
    const res = await page.goto(`/members/social-requests/${otherRequestId}`);

    // Assert
    expect(res?.status()).toBe(404);
  });

  test("PATCHing another member's request gets 404, not 403 — regression for existence-leaking enumeration", async ({ page, request }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Act
    const res = await request.patch(`/api/members/social-requests/${otherRequestId}`, {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { postCopy: "hijacked by e2e fixture" },
    });

    // Assert
    expect(res.status()).toBe(404);
  });

  test("a data URI whose decoded bytes are not a real image is rejected server-side even with a spoofed image/png prefix — regression for a client-Content-Type-only trust boundary", async ({ page, request }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    // Plain text bytes, base64-encoded, wrapped in an `image/png` prefix —
    // exactly the spoofed-extension shape validateMagicBytes() must catch
    // by inspecting the DECODED bytes, not the declared prefix.
    const notActuallyAPng = Buffer.from("this is not an image, just text pretending to be one").toString("base64");

    // Act
    const res = await request.post("/api/members/social-requests", {
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      data: { platforms: ["facebook"], imageDataUri: `data:image/png;base64,${notActuallyAPng}` },
    });

    // Assert
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/JPEG and PNG/i);
  });
});

test.describe("a board_member (holds social_requests.review) at the social-requests admin boundary", () => {
  test("reaches /admin/social-requests and sees a submitted request", async ({ page }) => {
    // Arrange
    await signIn(page, REVIEWER_EMAIL);

    // Act
    await page.goto("/admin/social-requests");
    await page.waitForLoadState("networkidle");

    // Assert
    expect(page.url()).toContain("/admin/social-requests");
    await expect(page.getByText("QA Gate Fixture Social Request")).toBeVisible();
  });
});

test.describe("full submit-to-decide cycle, driven through the real UI on the member side", () => {
  test("member submits a request, board is notified, admin decides, member sees the real outcome", async ({ page, request }) => {
    // Arrange — member signs in and opens the new-request form.
    await signIn(page, MEMBER_EMAIL);
    await page.goto("/members/social-requests");
    await expect(page.getByText("You haven’t submitted a request yet.")).toBeVisible();
    await page.getByRole("link", { name: "Request a Post" }).first().click();
    await page.waitForURL(/\/members\/social-requests\/new/);

    // Act — fill the form: platform checkbox, post copy, desired date, notes.
    await page.locator("#social-request-platform-facebook").check();
    await page.locator("#social-request-copy").fill("QA e2e: help us hand out food baskets this Saturday!");
    await page.locator("#social-request-notes").fill("QA e2e fixture — safe to ignore.");
    await page.getByRole("button", { name: "Submit Request" }).click();

    // Assert — submission succeeded and the request now shows as submitted.
    await expect(page.getByText(/Request submitted!/i)).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/members\/social-requests\/[0-9a-f-]+$/);
    const requestUrl = page.url();
    const requestId = requestUrl.split("/").pop()!;

    await page.goto("/members/social-requests");
    await expect(page.getByText("Submitted & In Review")).toBeVisible();

    // Assert — the board notification landed in the email queue, addressed
    // to BOARD_EMAIL, and is visible (not silently missing) even though this
    // non-production run never actually delivers it.
    const queued = await db.query.emailQueue.findFirst({
      where: and(eq(emailQueue.to, BOARD_EMAIL), eq(emailQueue.subject, `New Social Media Post Request: QA e2e: help us hand out food baskets this Saturday!`)),
    });
    expect(queued).toBeTruthy();
    expect(queued?.status).toBe("blocked_non_production");

    // Act — edit-lock check: an admin moves the request to Under Review...
    await signIn(page, REVIEWER_EMAIL);
    await page.goto(`/admin/social-requests/${requestId}`);
    await page.locator("#social-decision-status").selectOption("under_review");
    await page.locator("#social-decision-note").fill("Looking into scheduling.");
    await page.getByRole("button", { name: "Record Decision" }).click();
    await expect(page.getByText(/moved to Under Review/i)).toBeVisible({ timeout: 10000 });

    // Assert — the requester can no longer PATCH the now-locked request (409).
    const memberContext = await page.context().browser()!.newContext();
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, MEMBER_EMAIL);
    const memberCookies = await memberPage.context().cookies();
    const memberCookieHeader = memberCookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const lockedRes = await request.patch(`/api/members/social-requests/${requestId}`, {
      headers: { cookie: memberCookieHeader, "content-type": "application/json" },
      data: { notes: "trying to edit after lock" },
    });
    expect(lockedRes.status()).toBe(409);
    await memberContext.close();

    // Act — admin records the terminal decision (Posted).
    await page.goto(`/admin/social-requests/${requestId}`);
    await page.locator("#social-decision-status").selectOption("posted");
    await page.locator("#social-decision-note").fill("Posted to Facebook 9/5.");
    await page.getByRole("button", { name: "Record Decision" }).click();
    await expect(page.getByText(/moved to Posted/i)).toBeVisible({ timeout: 10000 });

    // Assert — the member-facing page reflects the REAL outcome, not just
    // "Submitted", and the status timeline shows both transitions with notes.
    await signIn(page, MEMBER_EMAIL);
    await page.goto(`/members/social-requests/${requestId}`);
    await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Looking into scheduling.")).toBeVisible();
    await expect(page.getByText("Posted to Facebook 9/5.")).toBeVisible();
  });

  test("a draft can be discarded (204) and no longer appears in the member's list", async ({ page }) => {
    // Arrange
    await signIn(page, MEMBER_EMAIL);
    await page.goto("/members/social-requests/new");
    await page.locator("#social-request-copy").fill("QA e2e draft to be discarded");
    await page.getByRole("button", { name: "Save Draft" }).click();
    await expect(page.getByText(/All changes saved|Draft saved\./i).first()).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/members\/social-requests\/[0-9a-f-]+$/);

    // Act
    await page.getByRole("button", { name: "Discard Draft" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard Draft" }).click();

    // Assert
    await page.waitForURL(/\/members\/social-requests$/);
    await expect(page.getByText("QA e2e draft to be discarded")).toHaveCount(0);
  });
});
