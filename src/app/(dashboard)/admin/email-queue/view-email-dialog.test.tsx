/**
 * Unit tests for StatusPill's handling of the transient `retrying` status —
 * B-66 (docs/work-log/2026-09-25-retry-stranding.md). The task's visibility
 * question was whether a `retrying` row should render at all, or silently
 * fall through to the pre-existing unknown-status fallback the way every
 * other unrecognized string does. This asserts the decision made: `retrying`
 * gets its own label and style (matching the precedent set for
 * `dev_no_api_key`), so a row ever observed mid-claim reads as "in
 * progress," not as a broken/unknown state.
 *
 * Hermetic, no-jsdom test via renderToStaticMarkup, matching the pattern in
 * src/components/admin/admin-sidebar.test.tsx.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusPill } from "./view-email-dialog";

describe("StatusPill — retrying (B-66)", () => {
  it("renders a distinct 'Retrying…' label, not the raw string and not the unknown-status fallback", () => {
    const html = renderToStaticMarkup(<StatusPill status="retrying" />);

    expect(html).toContain("Retrying…");
    expect(html).not.toContain(">retrying<");
  });

  it("uses a style distinct from both 'failed' (amber) and the unknown-status fallback (gray)", () => {
    const retryingHtml = renderToStaticMarkup(<StatusPill status="retrying" />);
    const failedHtml = renderToStaticMarkup(<StatusPill status="failed" />);
    const unknownHtml = renderToStaticMarkup(<StatusPill status="some_future_status" />);

    expect(retryingHtml).toContain("bg-blue-100");
    expect(retryingHtml).not.toContain("bg-amber-100");
    expect(failedHtml).toContain("bg-amber-100");
    expect(unknownHtml).toContain("bg-gray-100");
    expect(unknownHtml).toContain(">some_future_status<");
  });

  it("still falls back gracefully for a genuinely unrecognized status (unchanged pre-existing behavior)", () => {
    const html = renderToStaticMarkup(<StatusPill status="totally_made_up" />);

    expect(html).toContain(">totally_made_up<");
    expect(html).toContain("bg-gray-100");
  });
});
