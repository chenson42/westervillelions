/**
 * The Email Queue gate has ONE spelling (EMAIL_QUEUE_FEATURES, DECISION-115) used by the page,
 * the retry route, the admin layout badge query and the sidebar badge. The nav entry in
 * ADMIN_NAVIGATION must declare the same set, because the proxy derives /admin/email-queue's
 * rule from it: if the two drift, a user the page admits is bounced by the proxy (or the
 * reverse). Phase 5 (qa) found the nav entry spells the pair inline rather than from the
 * constant, so this pins them together until the follow-up removes ADMIN_USERS from both.
 */
import { describe, it, expect } from "vitest";
import { ADMIN_NAVIGATION, EMAIL_QUEUE_FEATURES, FEATURES, getAdminProtectionRules } from "./permissions";

describe("Email Queue gate parity", () => {
  it("should declare exactly EMAIL_QUEUE_FEATURES as the Email Queue nav item's requiredFeature — regression for nav/page gate drift", () => {
    // Arrange
    const item = ADMIN_NAVIGATION.flatMap((g) => g.items).find((i) => i.href === "/admin/email-queue");

    // Act
    const declared = ([] as string[]).concat(item?.requiredFeature ?? []).sort();

    // Assert
    expect(declared).toEqual([...EMAIL_QUEUE_FEATURES].sort());
  });

  it("should derive a proxy rule for /admin/email-queue that admits a holder of EMAIL_QUEUE_MANAGE alone", () => {
    // Arrange
    const rule = getAdminProtectionRules().find((r) => r.segment === "email-queue");

    // Act / Assert
    expect(rule?.requiredFeatures).toContain(FEATURES.EMAIL_QUEUE_MANAGE);
  });
});
