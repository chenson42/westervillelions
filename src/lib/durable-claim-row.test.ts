/**
 * Unit tests for src/lib/durable-claim-row.ts (B-73, DECISION-102/103).
 *
 * docs/work-log/2026-09-25-bulk-send-success-columns.md, Phase 3
 * "Unit Tests To Deliver" items 1-5.
 */

import { describe, it, expect } from "vitest";
import { durableOutcomeToRow } from "./durable-claim-row";
import type { DurableSendOutcome } from "@/lib/email-durable-claim";

describe("durableOutcomeToRow", () => {
  it("1. maps 'delivered' to { success: true, error: null }", () => {
    expect(durableOutcomeToRow({ outcome: "delivered" })).toEqual({
      success: true,
      error: null,
    });
  });

  it("2. maps 'failed' to { success: false, error } verbatim, not rewritten", () => {
    expect(durableOutcomeToRow({ outcome: "failed", error: "Resend rejected" })).toEqual({
      success: false,
      error: "Resend rejected",
    });
  });

  it("3. maps 'not_delivered'/blocked_non_production to the exact financial-report-send.ts wording", () => {
    expect(
      durableOutcomeToRow({ outcome: "not_delivered", reason: "blocked_non_production" }),
    ).toEqual({
      success: false,
      error:
        "Blocked — outbound email is disabled outside production (EMAIL_DEV_ALLOWLIST). Nothing was delivered.",
    });
  });

  it("4. maps 'not_delivered'/dev_no_api_key to the exact dev-no-key wording", () => {
    expect(durableOutcomeToRow({ outcome: "not_delivered", reason: "dev_no_api_key" })).toEqual({
      success: false,
      error: "Blocked — no RESEND_API_KEY is configured outside production. Nothing was delivered.",
    });
  });

  it("5. an unhandled/malformed outcome shape throws (never-check default branch)", () => {
    const bogus = { outcome: "bogus" } as unknown as DurableSendOutcome;
    expect(() => durableOutcomeToRow(bogus)).toThrow();
  });
});
