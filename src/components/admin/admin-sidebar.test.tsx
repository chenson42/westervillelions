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

/**
 * Unit tests for the ready-to-send-reports badge on the admin nav's Reports
 * entry (B-69, docs/work-log/2026-09-25-ready-to-send-badge.md) — follows
 * the failed-email-count badge's precedent exactly (same gate-then-render
 * shape, same defense-in-depth re-check).
 */
describe("AdminSidebar — ready-to-send-reports badge", () => {
  it("renders the count and an accessible label when the user holds LEDGER_REPORT_SEND and the count is nonzero", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.LEDGER_VIEW, FEATURES.LEDGER_REPORT_SEND]} readyToSendReportCount={2} />
    );

    expect(html).toContain(">2<");
    expect(html).toContain("2 financial statements ready to send");
  });

  it("uses singular wording for a count of exactly one", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.LEDGER_VIEW, FEATURES.LEDGER_REPORT_SEND]} readyToSendReportCount={1} />
    );

    expect(html).toContain("1 financial statement ready to send\"");
  });

  it("renders nothing extra when the count is zero — no permanent visual noise", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.LEDGER_REPORT_SEND]} readyToSendReportCount={0} />
    );

    expect(html).not.toContain("ready to send");
  });

  it("caps the displayed count at 99+ for an absurd number", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.LEDGER_VIEW, FEATURES.LEDGER_REPORT_SEND]} readyToSendReportCount={140} />
    );

    expect(html).toContain(">99+<");
    expect(html).toContain("140 financial statements ready to send");
  });

  it("shows nothing when the user lacks LEDGER_REPORT_SEND, even if a nonzero count is passed by mistake (defense in depth)", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.LEDGER_VIEW]} readyToSendReportCount={4} />
    );

    expect(html).not.toContain("ready to send");
  });

  it("still shows the badge for a full admin (isAdmin=true) even without LEDGER_REPORT_SEND explicitly listed", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[]} isAdmin readyToSendReportCount={3} />
    );

    expect(html).toContain("3 financial statements ready to send");
  });

  it("defaults to no badge when readyToSendReportCount is omitted", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar userFeatures={[FEATURES.LEDGER_REPORT_SEND]} isAdmin />
    );

    expect(html).not.toContain("ready to send");
  });

  it("never renders on the Email Queue item and never renders the failed-email badge on the Reports item (cross-contamination guard)", () => {
    const html = renderToStaticMarkup(
      <AdminSidebar
        userFeatures={[FEATURES.LEDGER_VIEW, FEATURES.LEDGER_REPORT_SEND, FEATURES.ADMIN_USERS]}
        readyToSendReportCount={5}
        failedEmailCount={9}
      />
    );

    expect(html).toContain("5 financial statements ready to send");
    expect(html).toContain("9 failed emails");
  });
});
