/**
 * Unit tests for StatusPill's `dev_no_api_key` handling — Phase 6 follow-up
 * #2, docs/work-log/2026-09-25-email-silent-success.md: rows with this
 * status previously rendered in no section of /admin/email-queue at all
 * (StatusPill's unknown-status fallback silently relabeled them "Pending"),
 * so a developer with no local RESEND_API_KEY saw an empty queue and
 * couldn't tell whether their test email "went out". This confirms the new
 * status gets its own label/color rather than falling through to the
 * pre-existing "unknown status" fallback.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPill } from "./view-email-dialog";

describe("StatusPill", () => {
  it("labels dev_no_api_key distinctly — never as 'Sent' or silently as 'Pending'", () => {
    const html = renderToStaticMarkup(<StatusPill status="dev_no_api_key" />);

    expect(html).toContain("Not sent");
    expect(html).toContain("no API key");
    expect(html).not.toContain(">Sent<");
    expect(html).not.toContain(">Pending<");
  });

  it("gives dev_no_api_key a distinct color from blocked_non_production", () => {
    const devHtml = renderToStaticMarkup(<StatusPill status="dev_no_api_key" />);
    const blockedHtml = renderToStaticMarkup(
      <StatusPill status="blocked_non_production" />
    );

    expect(devHtml).not.toBe(blockedHtml);
    expect(devHtml).toContain("bg-purple-100");
    expect(blockedHtml).toContain("bg-lions-blue/10");
  });

  it("still falls back to the pending style for a genuinely unrecognized status", () => {
    const html = renderToStaticMarkup(<StatusPill status="some_future_status" />);

    expect(html).toContain("some_future_status");
    expect(html).toContain("bg-gray-100");
  });

  it("still renders the existing known statuses unchanged", () => {
    expect(renderToStaticMarkup(<StatusPill status="sent" />)).toContain(">Sent<");
    expect(renderToStaticMarkup(<StatusPill status="failed" />)).toContain(">Failed<");
  });
});
