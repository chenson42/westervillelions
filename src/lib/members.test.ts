/**
 * Unit tests for src/lib/members.ts — the isActive/membershipStatus invariant
 * and the provisioning gates named in the Phase 3 design
 * (docs/work-log/2026-07-26-prospective-members.md).
 *
 * All tests are pure (no DB). members.ts imports `@/lib/db` at module scope
 * (via provisionUserForMember's dependencies), so @/lib/db is mocked to avoid
 * a real DB connection attempt during import — same pattern as
 * src/lib/permissions-server.test.ts.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    query: { users: { findFirst: vi.fn() }, roles: { findFirst: vi.fn() } },
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import {
  isActiveForStatus,
  shouldProvisionOnMemberCreate,
  shouldProvisionOnMemberUpdate,
  resolveJoinDate,
  type MembershipStatus,
} from "./members";

// ── isActiveForStatus ───────────────────────────────────────────────────────

describe("isActiveForStatus", () => {
  it("'active' → true", () => {
    expect(isActiveForStatus("active")).toBe(true);
  });

  it("'prospective' → false", () => {
    expect(isActiveForStatus("prospective")).toBe(false);
  });

  it("'ended' → false", () => {
    expect(isActiveForStatus("ended")).toBe(false);
  });
});

// ── shouldProvisionOnMemberCreate ───────────────────────────────────────────

describe("shouldProvisionOnMemberCreate", () => {
  it("'active' → true", () => {
    expect(shouldProvisionOnMemberCreate("active")).toBe(true);
  });

  it("'prospective' → false", () => {
    expect(shouldProvisionOnMemberCreate("prospective")).toBe(false);
  });

  it("'ended' → false", () => {
    expect(shouldProvisionOnMemberCreate("ended")).toBe(false);
  });
});

// ── shouldProvisionOnMemberUpdate ───────────────────────────────────────────

describe("shouldProvisionOnMemberUpdate", () => {
  it("prospective → active, no linked user → true (the induction gap)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "prospective",
        newStatus: "active",
        hasLinkedUser: false,
        emailChanged: false,
      })
    ).toBe(true);
  });

  it("active, email changed, no linked user → true (legacy defensive path, preserved)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "active",
        newStatus: "active",
        hasLinkedUser: false,
        emailChanged: true,
      })
    ).toBe(true);
  });

  it("active, email changed, has linked user → false (already provisioned; re-affirm link only)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "active",
        newStatus: "active",
        hasLinkedUser: true,
        emailChanged: true,
      })
    ).toBe(false);
  });

  it("prospective, email changed, no linked user → false (the exact bug being fixed)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "prospective",
        newStatus: "prospective",
        hasLinkedUser: false,
        emailChanged: true,
      })
    ).toBe(false);
  });

  it("active → ended, no linked user → false (never provision on a downgrade)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "active",
        newStatus: "ended",
        hasLinkedUser: false,
        emailChanged: false,
      })
    ).toBe(false);
  });

  it("active → active (no status change, no email change) → false (no-op)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "active",
        newStatus: "active",
        hasLinkedUser: false,
        emailChanged: false,
      })
    ).toBe(false);
  });

  it("ended → active, no linked user → true (reactivation gets the same treatment as induction)", () => {
    expect(
      shouldProvisionOnMemberUpdate({
        previousStatus: "ended",
        newStatus: "active",
        hasLinkedUser: false,
        emailChanged: false,
      })
    ).toBe(true);
  });
});

// ── resolveJoinDate ──────────────────────────────────────────────────────────

describe("resolveJoinDate", () => {
  it("becameActive: true, no existing join date, no submitted date → returns now", () => {
    const now = new Date("2026-07-26T12:00:00Z");
    const result = resolveJoinDate({
      becameActive: true,
      existingJoinDate: null,
      submittedJoinDate: null,
      now,
    });
    expect(result).toEqual(now);
  });

  it("becameActive: true, no existing join date, submitted date provided → admin override wins", () => {
    const submitted = new Date("2026-01-15T00:00:00Z");
    const now = new Date("2026-07-26T12:00:00Z");
    const result = resolveJoinDate({
      becameActive: true,
      existingJoinDate: null,
      submittedJoinDate: submitted,
      now,
    });
    expect(result).toEqual(submitted);
  });

  it("becameActive: true, existing join date already set, no submitted date → existing date is never overwritten", () => {
    const existing = new Date("2020-05-02T00:00:00Z");
    const now = new Date("2026-07-26T12:00:00Z");
    const result = resolveJoinDate({
      becameActive: true,
      existingJoinDate: existing,
      submittedJoinDate: null,
      now,
    });
    expect(result).toEqual(existing);
  });

  it("becameActive: false → returns submittedJoinDate ?? existingJoinDate (unchanged behavior for non-transition edits)", () => {
    const existing = new Date("2020-05-02T00:00:00Z");
    const submitted = new Date("2021-06-03T00:00:00Z");

    expect(
      resolveJoinDate({
        becameActive: false,
        existingJoinDate: existing,
        submittedJoinDate: submitted,
      })
    ).toEqual(submitted);

    expect(
      resolveJoinDate({
        becameActive: false,
        existingJoinDate: existing,
        submittedJoinDate: null,
      })
    ).toEqual(existing);

    expect(
      resolveJoinDate({
        becameActive: false,
        existingJoinDate: null,
        submittedJoinDate: null,
      })
    ).toBeNull();
  });
});

// Type-level sanity check (compile-time only): every literal used above must
// be assignable to MembershipStatus.
const _statuses: MembershipStatus[] = ["prospective", "active", "ended"];
void _statuses;
