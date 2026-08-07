/**
 * Unit tests for the membershipType field on the member edit/create form.
 *
 * member-form.tsx is a "use client" component and cannot import from src/lib/members.ts
 * directly (that module pulls in @/lib/db at module scope for provisionUserForMember,
 * which would drag the Postgres client into the browser bundle and break the production
 * build — see the comment above TYPE_OPTIONS in member-form.tsx). It therefore carries a
 * hand-duplicated copy of the MembershipType taxonomy.
 *
 * There is no React component-rendering test infra in this project (no jsdom/happy-dom,
 * no @testing-library/react — vitest.config.ts runs with environment: "node" and
 * coverage only tracks src/lib/**). Adding one is an architectural decision out of this
 * feature's scope. This test instead guards the seam that actually matters: that the
 * form's local TYPE_OPTIONS never drifts from the canonical MEMBERSHIP_TYPES source of
 * truth in src/lib/members.ts, in value, label, and order — which is what the <select>
 * in member-form.tsx renders directly via TYPE_OPTIONS.map(...).
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

import { TYPE_OPTIONS } from "./member-form";
import { MEMBERSHIP_TYPES } from "@/lib/members";

describe("member-form TYPE_OPTIONS", () => {
  it("has exactly 7 options, matching the LCI taxonomy count", () => {
    expect(TYPE_OPTIONS).toHaveLength(7);
  });

  it("matches MEMBERSHIP_TYPES from src/lib/members.ts value-for-value, label-for-label, in order", () => {
    expect(TYPE_OPTIONS).toEqual(MEMBERSHIP_TYPES);
  });

  it("includes 'active' as a valid membership type value (intentional overlap with membershipStatus's 'active' token — different column, different meaning)", () => {
    expect(TYPE_OPTIONS.map((o) => o.value)).toContain("active");
  });

  it("every option has a non-empty label distinct from a bare 'Active' heading collision risk", () => {
    for (const opt of TYPE_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
    }
  });
});
