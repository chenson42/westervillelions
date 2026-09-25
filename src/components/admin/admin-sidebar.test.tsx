/**
 * Unit tests for the failed-email-count badge on the admin nav's Email Queue
 * entry, added as Phase 6 follow-up #1 of
 * docs/work-log/2026-09-25-email-silent-success.md: "a signal nobody looks
 * at is not a signal" — the fix for the silent-success bug makes a missing
 * RESEND_API_KEY visible on /admin/email-queue, but nothing surfaced that
 * page's failed count anywhere else. This badge is the fix.
 *
 * Hermetic, no-jsdom test via renderToStaticMarkup, matching the pattern in
 * src/components/events/occurrence-signup-list.test.tsx — AdminSidebar is a
 * client component but its initial render needs no browser APIs. usePathname
 * is mocked since AdminSidebar calls it directly.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AdminSidebar from "./admin-sidebar";
import { FEATURES } from "@/lib/permissions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
}));

describe("AdminSidebar — failed-email-count badge", () => {
  it("renders the count and an accessible label when the user holds ADMIN_USERS and the count is nonzero", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.ADMIN_USERS]} failedEmailCount={3} />
    );

    expect(html).toContain(">3<");
    expect(html).toContain("3 failed emails");
  });

  it("uses singular wording for a count of exactly one", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.ADMIN_USERS]} failedEmailCount={1} />
    );

    expect(html).toContain("1 failed email\"");
  });

  it("renders nothing extra when the count is zero — no permanent visual noise", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.ADMIN_USERS]} failedEmailCount={0} />
    );

    expect(html).not.toContain("failed email");
  });

  it("caps the displayed count at 99+ for an absurd number", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.ADMIN_USERS]} failedEmailCount={140} />
    );

    expect(html).toContain(">99+<");
    expect(html).toContain("140 failed emails");
  });

  it("shows nothing when the user lacks ADMIN_USERS, even if a nonzero count is passed by mistake (defense in depth)", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={["some.other.feature"]} failedEmailCount={7} />
    );

    expect(html).not.toContain("failed email");
  });

  it("still shows the badge for a full admin (isAdmin=true) even without ADMIN_USERS explicitly listed", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[]} isAdmin failedEmailCount={2} />
    );

    expect(html).toContain("2 failed emails");
  });

  it("defaults to no badge when failedEmailCount is omitted", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.ADMIN_USERS]} isAdmin />
    );

    expect(html).not.toContain("failed email");
  });
});
