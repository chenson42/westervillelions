/**
 * Unit tests for the pure amount-threshold helpers backing AcknowledgeDialog
 * (docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md, Part 2 —
 * Phase 3 design's named unit tests #9-10). Extracted from the component
 * because AcknowledgeDialog renders inside a Radix Dialog.Portal, which
 * no-ops under this project's DOM-less Vitest config — see this module's own
 * header comment for the full reasoning (mirrors ack-queue-ui.ts's split).
 */

import { describe, it, expect } from "vitest";
import {
  isUnderAckThreshold,
  defaultTypeOverride,
  showCourtesyNote,
  ACK_REQUIRED_THRESHOLD_CENTS,
} from "./acknowledge-dialog-ui";

describe("isUnderAckThreshold", () => {
  it("is true below $250", () => {
    expect(isUnderAckThreshold(2000)).toBe(true); // $20
    expect(isUnderAckThreshold(24999)).toBe(true); // $249.99
  });

  it("is false at or above $250", () => {
    expect(isUnderAckThreshold(25000)).toBe(false); // exactly $250
    expect(isUnderAckThreshold(50000)).toBe(false); // $500
  });

  it("$250 is exactly the threshold constant", () => {
    expect(ACK_REQUIRED_THRESHOLD_CENTS).toBe(25000);
  });
});

describe("defaultTypeOverride — Part 2's behavioral core", () => {
  it("pre-selects 'written_ack_250' when amountCents < $250, so submitting the happy path never 422s", () => {
    expect(defaultTypeOverride(2000)).toBe("written_ack_250");
    expect(defaultTypeOverride(24999)).toBe("written_ack_250");
  });

  it("leaves the override empty (auto-detect from amount) when amountCents >= $250", () => {
    expect(defaultTypeOverride(25000)).toBe("");
    expect(defaultTypeOverride(100000)).toBe("");
  });
});

describe("showCourtesyNote", () => {
  it("shows the courtesy-vs-required note only when amountCents < $250", () => {
    expect(showCourtesyNote(2000)).toBe(true);
    expect(showCourtesyNote(25000)).toBe(false);
  });
});
