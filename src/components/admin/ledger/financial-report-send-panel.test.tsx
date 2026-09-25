/**
 * Unit tests for FinancialReportSendPanel
 * (docs/work-log/2026-09-25-financial-report-auto-send.md, Phase 4 (UI)).
 *
 * This project's Vitest config runs in `environment: "node"` — no
 * jsdom/@testing-library/react (see member-form.test.ts's docblock for the
 * prior art on this constraint). Rendering is exercised via
 * `react-dom/server`'s `renderToStaticMarkup`, the same technique used by
 * donor-detail-client.test.tsx: `<ConfirmDialog>`'s Radix AlertDialog.Root
 * renders `open={false}` until a row is clicked, so its Portal contributes
 * nothing to the static markup and the card grid is fully inspectable
 * without a DOM.
 *
 * Interaction that needs real event handling (the double-submit race, the
 * fetch-response-to-toast mapping) is tested instead against the plain,
 * exported, framework-free functions the component calls into
 * (`createSingleFlightGuard`, `errorMessageFor`) — decoupled from React
 * entirely, so no click simulation is required.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReadyToSendReport } from "@/lib/financial-report-send";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import FinancialReportSendPanel, {
  createSingleFlightGuard,
  errorMessageFor,
} from "./financial-report-send-panel";

function baseRow(overrides: Partial<ReadyToSendReport> = {}): ReadyToSendReport {
  return {
    entityId: "entity-club",
    entitySlug: "club",
    entityName: "Club",
    fundId: "fund-admin",
    fundName: "Administrative Fund",
    month: "2026-09",
    monthEndLabel: "September 30, 2026",
    summary: {
      endingBookBalanceCents: 500000,
      netOneMonthCents: 12000,
      netTwelveMonthCents: 34000,
    },
    fingerprint: "abc123",
    state: "never_sent",
    lastSuccessfulSend: null,
    lastAttemptFailed: null,
    ...overrides,
  };
}

describe("FinancialReportSendPanel — rendering per state", () => {
  it("renders the empty state when there are no rows", () => {
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[]} canSend={true} />);
    expect(html).toContain("No statements ready to send yet.");
  });

  it("never_sent: shows the 'Not yet sent' badge and a 'Send to Board' button", () => {
    const row = baseRow({ state: "never_sent" });
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[row]} canSend={true} />);
    expect(html).toContain("Not yet sent");
    expect(html).toContain(">Send to Board<");
    expect(html).not.toContain("Resend Corrected Statement");
  });

  it("corrected: shows the 'Corrected' badge, the superseded-statement note, and a 'Resend Corrected Statement' button", () => {
    const row = baseRow({
      state: "corrected",
      lastSuccessfulSend: { sentAt: "2026-09-10T12:00:00Z", signedAsName: "Pat Treasurer" },
    });
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[row]} canSend={true} />);
    expect(html).toContain("Corrected");
    expect(html).toContain("The figures changed since the statement sent on");
    expect(html).toContain(">Resend Corrected Statement<");
    expect(html).not.toContain(">Send to Board<");
  });

  it("sent: shows the 'Sent' badge, the sent-on date/signer line, and no send button", () => {
    const row = baseRow({
      state: "sent",
      lastSuccessfulSend: { sentAt: "2026-09-10T12:00:00Z", signedAsName: "Pat Treasurer" },
    });
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[row]} canSend={true} />);
    expect(html).toContain(">Sent<");
    expect(html).toContain("Sent September 10, 2026 by Pat Treasurer");
    expect(html).not.toContain(">Send to Board<");
    expect(html).not.toContain("Resend Corrected Statement");
  });

  it("shows a last-attempt-failed note when present, regardless of state", () => {
    const row = baseRow({
      state: "never_sent",
      lastAttemptFailed: { sentAt: "2026-09-11T12:00:00Z", error: "Resend API timeout" },
    });
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[row]} canSend={true} />);
    expect(html).toContain("Last attempt failed on September 11, 2026: Resend API timeout");
  });
});

describe("FinancialReportSendPanel — permission gating", () => {
  it("renders no send control for a viewer lacking LEDGER_REPORT_SEND, even on an actionable row", () => {
    const row = baseRow({ state: "never_sent" });
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[row]} canSend={false} />);
    expect(html).not.toContain(">Send to Board<");
    expect(html).not.toContain("Resend Corrected Statement");
    // The informational content (state, figures) is still visible.
    expect(html).toContain("Not yet sent");
    expect(html).toContain("September 30, 2026");
  });

  it("still shows no send control for a corrected row without permission", () => {
    const row = baseRow({
      state: "corrected",
      lastSuccessfulSend: { sentAt: "2026-09-10T12:00:00Z", signedAsName: null },
    });
    const html = renderToStaticMarkup(<FinancialReportSendPanel rows={[row]} canSend={false} />);
    expect(html).not.toContain("Resend Corrected Statement");
    expect(html).toContain("Corrected");
  });
});

describe("errorMessageFor — typed failure-reason to human copy", () => {
  it("treasurer_unresolved / none surfaces the specific 'nobody holds Treasurer' message, not a generic error", () => {
    const msg = errorMessageFor("treasurer_unresolved", "none");
    expect(msg).toContain("Nobody currently holds the Board position of Treasurer");
    expect(msg).not.toBe("Something went wrong sending this statement. Try again.");
  });

  it("treasurer_unresolved / no_board_group surfaces the missing-group message", () => {
    const msg = errorMessageFor("treasurer_unresolved", "no_board_group");
    expect(msg).toContain('No "Board of Directors" group was found');
  });

  it("treasurer_unresolved / multiple surfaces the ambiguous-Treasurer message", () => {
    const msg = errorMessageFor("treasurer_unresolved", "multiple");
    expect(msg).toContain("More than one member is marked as Treasurer");
  });

  it("already_sent, not_ready, and the generic fallback are each distinct, human copy (never a bare error code)", () => {
    const alreadySent = errorMessageFor("already_sent", undefined);
    const notReady = errorMessageFor("not_ready", undefined);
    const fallback = errorMessageFor("some_future_reason_not_yet_mapped", undefined);

    for (const msg of [alreadySent, notReady, fallback]) {
      expect(msg).not.toMatch(/^[a-z_]+$/); // never just the raw reason code
      expect(msg.length).toBeGreaterThan(10);
    }
    expect(alreadySent).not.toBe(notReady);
    expect(notReady).not.toBe(fallback);
  });

  it("send_failed includes the detail message when present", () => {
    const msg = errorMessageFor("send_failed", "Resend API returned 500");
    expect(msg).toContain("Resend API returned 500");
  });
});

describe("createSingleFlightGuard — double-submit guard", () => {
  it("acquire() returns true once, then false for a concurrent call, until release()", () => {
    const guard = createSingleFlightGuard();
    expect(guard.acquire()).toBe(true);
    // Simulates a double-click: a second acquire() call before the first
    // request's release() — this is the exact race a double-click creates.
    expect(guard.acquire()).toBe(false);
    expect(guard.acquire()).toBe(false);

    guard.release();
    expect(guard.acquire()).toBe(true);
  });

  it("two independent guards (two different rows) don't interfere with each other", () => {
    const guardA = createSingleFlightGuard();
    const guardB = createSingleFlightGuard();
    expect(guardA.acquire()).toBe(true);
    expect(guardB.acquire()).toBe(true);
    expect(guardA.acquire()).toBe(false);
    expect(guardB.acquire()).toBe(false);
  });
});
