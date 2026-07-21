import { describe, it, expect } from "vitest";
import {
  FEATURES,
  FEATURE_DESCRIPTIONS,
  FEATURE_CATEGORIES,
  ROLES,
  getFeaturesByCategory,
  type FeatureName,
} from "./permissions";

// ── FEATURE_DESCRIPTIONS catalog completeness ─────────────────────────────────
// Guards against a new FEATURES constant being added without a matching entry in
// FEATURE_DESCRIPTIONS. Missing descriptions render as `undefined` in the admin
// roles UI — a silent UX defect that only shows when a new key is added.
//
// Pattern: iterate every value in FEATURES, assert a non-empty string exists in
// FEATURE_DESCRIPTIONS. Fails immediately on the missing key, printing which feature
// lacks a description. Regression guard: see "Top 5 Prioritized Gaps #4" in
// docs/reviews/2026-05-18-test-coverage.md.

describe("FEATURE_DESCRIPTIONS catalog completeness", () => {
  it("should have a non-empty description for every FEATURES value — regression for missing-description defect", () => {
    // Arrange — every known feature name
    const allFeatureNames = Object.values(FEATURES) as FeatureName[];

    // Act + Assert — each name must have a description
    for (const featureName of allFeatureNames) {
      expect(
        FEATURE_DESCRIPTIONS[featureName],
        `FEATURE_DESCRIPTIONS is missing an entry for "${featureName}"`
      ).toBeDefined();

      expect(
        FEATURE_DESCRIPTIONS[featureName].length,
        `FEATURE_DESCRIPTIONS["${featureName}"] must be a non-empty string`
      ).toBeGreaterThan(0);
    }
  });

  it("should not have entries in FEATURE_DESCRIPTIONS for keys that are not in FEATURES", () => {
    // Arrange — collect the full set of known feature name values
    const knownFeatureValues = new Set(Object.values(FEATURES));

    // Act + Assert — every key in FEATURE_DESCRIPTIONS must be a known feature
    for (const descKey of Object.keys(FEATURE_DESCRIPTIONS) as FeatureName[]) {
      expect(
        knownFeatureValues.has(descKey),
        `FEATURE_DESCRIPTIONS has an orphan key "${descKey}" not present in FEATURES`
      ).toBe(true);
    }
  });
});

// ── getFeaturesByCategory ─────────────────────────────────────────────────────
// Pure helper that filters FEATURES by dot-notation prefix. Used in admin UI to
// group permissions. A regression here would silently collapse entire sections.

describe("getFeaturesByCategory", () => {
  it("returns all member-prefixed features for the 'members' category", () => {
    // Arrange
    const memberFeatures = [
      FEATURES.MEMBERS_VIEW,
      FEATURES.MEMBERS_EDIT,
      FEATURES.MEMBERS_DELETE,
    ];

    // Act
    const result = getFeaturesByCategory(FEATURE_CATEGORIES.MEMBERS);

    // Assert
    expect(result).toHaveLength(memberFeatures.length);
    for (const f of memberFeatures) {
      expect(result).toContain(f);
    }
  });

  it("returns all admin-prefixed features for the 'admin' category", () => {
    // Arrange
    const adminFeatures = [
      FEATURES.ADMIN_DASHBOARD,
      FEATURES.ADMIN_USERS,
      FEATURES.ADMIN_ROLES,
      FEATURES.ADMIN_SECURITY_VIEW,
    ];

    // Act
    const result = getFeaturesByCategory(FEATURE_CATEGORIES.ADMIN);

    // Assert
    expect(result).toHaveLength(adminFeatures.length);
    for (const f of adminFeatures) {
      expect(result).toContain(f);
    }
  });

  it("returns an empty array for a category that matches no features", () => {
    // Arrange — a prefix that will never match
    const nonExistentCategory = "nonexistent-category-xyz";

    // Act
    const result = getFeaturesByCategory(nonExistentCategory);

    // Assert
    expect(result).toEqual([]);
  });

  it("returns all event-prefixed features for the 'events' category", () => {
    // Arrange
    const eventFeatures = [
      FEATURES.EVENTS_VIEW,
      FEATURES.EVENTS_CREATE,
      FEATURES.EVENTS_EDIT,
      FEATURES.EVENTS_DELETE,
    ];

    // Act
    const result = getFeaturesByCategory(FEATURE_CATEGORIES.EVENTS);

    // Assert
    expect(result).toHaveLength(eventFeatures.length);
    for (const f of eventFeatures) {
      expect(result).toContain(f);
    }
  });
});

// ── FEATURES catalog shape ────────────────────────────────────────────────────
// Lightweight sanity checks on the constants themselves. Not behavior tests, but
// catches copy-paste errors (duplicate values, wrong prefix) that the type system
// alone doesn't catch.

describe("FEATURES catalog shape", () => {
  it("every feature value should follow the 'category.action' dot-notation format", () => {
    // Arrange
    const allFeatureNames = Object.values(FEATURES);

    // Act + Assert
    for (const name of allFeatureNames) {
      expect(
        name,
        `FEATURES value "${name}" must match category.action format`
      ).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("should have no duplicate feature values", () => {
    // Arrange
    const allValues = Object.values(FEATURES);

    // Act
    const uniqueValues = new Set(allValues);

    // Assert
    expect(uniqueValues.size).toBe(allValues.length);
  });
});

// ── ROLES catalog ─────────────────────────────────────────────────────────────
// Lightweight sanity check — the ROLES constants must align with DB seed data.

describe("ROLES catalog", () => {
  it("should include admin, board_member, member, and volunteer", () => {
    // Arrange + Assert
    expect(Object.values(ROLES)).toContain("admin");
    expect(Object.values(ROLES)).toContain("board_member");
    expect(Object.values(ROLES)).toContain("member");
    expect(Object.values(ROLES)).toContain("volunteer");
  });
});
