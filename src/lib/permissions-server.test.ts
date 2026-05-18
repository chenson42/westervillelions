import { describe, it, expect, vi } from "vitest";

// Mock the DB module before any import that touches it.
// getFeaturesFromSession and sessionHasFeature are pure functions with no DB
// dependency, but permissions-server.ts imports `db` at module scope — the mock
// prevents the DB connection attempt during unit tests.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
    query: { users: { findFirst: vi.fn() } },
  },
}));

import {
  getFeaturesFromSession,
  sessionHasFeature,
} from "./permissions-server";
import { FEATURES } from "./permissions";

// ── getFeaturesFromSession ──────────────────────────────────────────────────────
// These two functions are the only pure (DB-free) exports in permissions-server.ts.
// They accept plain objects and return arrays/booleans. Every protected Server
// Component calls them; a bug here silently breaks all session-based permission gating.

describe("getFeaturesFromSession", () => {
  it("returns the features array from a session with a populated user", () => {
    // Arrange
    const session = {
      user: { features: ["members.view", "events.view", "admin.dashboard"] },
    };

    // Act
    const result = getFeaturesFromSession(session);

    // Assert
    expect(result).toEqual(["members.view", "events.view", "admin.dashboard"]);
  });

  it("returns an empty array when session.user.features is an empty array", () => {
    // Arrange
    const session = { user: { features: [] } };

    // Act
    const result = getFeaturesFromSession(session);

    // Assert
    expect(result).toEqual([]);
  });

  it("returns an empty array when session has no user property", () => {
    // Arrange — session exists but user key is absent
    const session = {};

    // Act
    const result = getFeaturesFromSession(session);

    // Assert
    expect(result).toEqual([]);
  });

  it("returns an empty array when session.user exists but features is undefined", () => {
    // Arrange — user present, features key absent
    const session = { user: {} };

    // Act
    const result = getFeaturesFromSession(session);

    // Assert
    expect(result).toEqual([]);
  });

  it("returns an empty array when session.user.features is null (unexpected but defensive)", () => {
    // Arrange — null coerced by the || [] fallback
    const session = { user: { features: null as unknown as string[] } };

    // Act
    const result = getFeaturesFromSession(session);

    // Assert
    expect(result).toEqual([]);
  });
});

// ── sessionHasFeature ──────────────────────────────────────────────────────────
// Called in every protected server component after session checks. A false-negative
// here (returning false when the user does have the feature) would silently block
// members from their own portal pages.

describe("sessionHasFeature", () => {
  it("returns true when the session user has the requested feature", () => {
    // Arrange
    const session = {
      user: { features: [FEATURES.MEMBERS_VIEW, FEATURES.EVENTS_VIEW] },
    };

    // Act
    const result = sessionHasFeature(session, FEATURES.MEMBERS_VIEW);

    // Assert
    expect(result).toBe(true);
  });

  it("returns false when the session user does not have the requested feature", () => {
    // Arrange — user has members.view but not admin.dashboard
    const session = {
      user: { features: [FEATURES.MEMBERS_VIEW] },
    };

    // Act
    const result = sessionHasFeature(session, FEATURES.ADMIN_DASHBOARD);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when session has no user property", () => {
    // Arrange
    const session = {};

    // Act
    const result = sessionHasFeature(session, FEATURES.MEMBERS_VIEW);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when session.user.features is empty", () => {
    // Arrange
    const session = { user: { features: [] } };

    // Act
    const result = sessionHasFeature(session, FEATURES.ADMIN_DASHBOARD);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when session.user.features is undefined", () => {
    // Arrange — user present but no features key
    const session = { user: {} };

    // Act
    const result = sessionHasFeature(session, FEATURES.MEMBERS_VIEW);

    // Assert
    expect(result).toBe(false);
  });

  it("returns true for each FEATURES constant when the session contains all features", () => {
    // Arrange — a super-admin session with every feature
    const allFeatures = Object.values(FEATURES);
    const session = { user: { features: allFeatures } };

    // Act + Assert — every known feature key must return true
    for (const feature of allFeatures) {
      expect(sessionHasFeature(session, feature)).toBe(true);
    }
  });
});
