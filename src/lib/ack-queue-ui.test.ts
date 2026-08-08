import { describe, it, expect } from "vitest";
import { ackQueueRowAction, ackQueueRowStatus } from "./ack-queue-ui";

// Regression coverage for the 2026-08-08 defect (second increment): AckQueue
// always rendered "Record acknowledgment", even for a row that already had
// an unsent acknowledgment — clicking it 409'd with no way to reach Mark
// Sent. These tests pin the pure decision `ack-queue.tsx` now uses instead
// of the removed "always show Record" simplification.

describe("ackQueueRowAction", () => {
  it("returns 'record' when the row has no acknowledgment yet (ackId null)", () => {
    expect(ackQueueRowAction(null)).toBe("record");
  });

  it("returns 'mark-sent' when the row already carries an unsent acknowledgment (ackId set) — the exact case that used to 409", () => {
    expect(ackQueueRowAction("ack-123")).toBe("mark-sent");
  });
});

describe("ackQueueRowStatus", () => {
  it("is 'unacknowledged' when no ack exists", () => {
    expect(ackQueueRowStatus(null)).toBe("unacknowledged");
  });

  it("is 'recorded' when an unsent ack exists — must read differently from 'unacknowledged' so the list is legible at a glance", () => {
    expect(ackQueueRowStatus("ack-123")).toBe("recorded");
  });
});
