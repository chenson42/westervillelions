import { describe, it, expect } from "vitest";
import {
  FEATURES,
  FEATURE_DESCRIPTIONS,
  FEATURE_CATEGORIES,
  ROLES,
  getFeaturesByCategory,
  canAccessAdminArea,
  getFirstAccessibleAdminHref,
  getAdminProtectionRules,
  ADMIN_NAVIGATION,
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
      FEATURES.EVENTS_ANNOUNCE,
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

// ── canAccessAdminArea ─────────────────────────────────────────────────────────
// Regression coverage for docs/work-log/2026-08-05-admin-area-gating.md: a
// budget-committee member (budget.edit, budget.view, ledger.view, events.view,
// impact.view, members.view — no admin.dashboard) was bounced to
// /access-pending because the admin layout's hard gate only recognized
// admin.dashboard. canAccessAdminArea is now the single rule used by the admin
// layout gate AND the header's Admin link, derived from the same
// ADMIN_NAVIGATION data AdminSidebar renders from.

describe("canAccessAdminArea", () => {
  it("admits a user holding admin.dashboard", () => {
    // Arrange
    const features = [FEATURES.ADMIN_DASHBOARD];

    // Act + Assert
    expect(canAccessAdminArea(features)).toBe(true);
  });

  it("admits a budget-committee member with budget features but no admin.dashboard — regression for the Lori Lampel bug", () => {
    // Arrange — Lori Lampel's real production feature set (member + budget_committee)
    const features = [
      FEATURES.BUDGET_EDIT,
      FEATURES.BUDGET_VIEW,
      FEATURES.LEDGER_VIEW,
      FEATURES.EVENTS_VIEW,
      FEATURES.IMPACT_VIEW,
      FEATURES.MEMBERS_VIEW,
    ];

    // Act + Assert
    expect(canAccessAdminArea(features)).toBe(true);
  });

  it("admits a user holding only budget.view (no budget.edit, no admin.dashboard)", () => {
    // Arrange
    const features = [FEATURES.BUDGET_VIEW];

    // Act + Assert
    expect(canAccessAdminArea(features)).toBe(true);
  });

  it("rejects a plain member with no admin-gating features at all", () => {
    // Arrange — e.g. MEMBERS_VIEW/EVENTS_VIEW/IMPACT_VIEW gate nothing in
    // ADMIN_NAVIGATION (only *_EDIT/_MANAGE-style keys do)
    const features = [FEATURES.MEMBERS_VIEW, FEATURES.EVENTS_VIEW, FEATURES.IMPACT_VIEW];

    // Act + Assert
    expect(canAccessAdminArea(features)).toBe(false);
  });

  it("rejects an empty features array", () => {
    expect(canAccessAdminArea([])).toBe(false);
  });

  it("rejects undefined features", () => {
    expect(canAccessAdminArea(undefined)).toBe(false);
  });

  it("rejects null features", () => {
    expect(canAccessAdminArea(null)).toBe(false);
  });
});

// ── getFirstAccessibleAdminHref ─────────────────────────────────────────────────
// Used to land a user who passes canAccessAdminArea but lacks admin.dashboard
// somewhere real instead of the ADMIN_DASHBOARD-gated stats page.

describe("getFirstAccessibleAdminHref", () => {
  it("returns /admin for a user holding admin.dashboard", () => {
    expect(getFirstAccessibleAdminHref([FEATURES.ADMIN_DASHBOARD])).toBe("/admin");
  });

  it("returns the Ledger href for Lori Lampel's feature set (Ledger sorts before Budgeting in ADMIN_NAVIGATION)", () => {
    // Arrange
    const features = [
      FEATURES.BUDGET_EDIT,
      FEATURES.BUDGET_VIEW,
      FEATURES.LEDGER_VIEW,
      FEATURES.EVENTS_VIEW,
      FEATURES.IMPACT_VIEW,
      FEATURES.MEMBERS_VIEW,
    ];

    // Act
    const href = getFirstAccessibleAdminHref(features);

    // Assert — whatever ADMIN_NAVIGATION's first matching item is; pinned to
    // /admin/ledger today (Treasury > Ledger, requiredFeature: LEDGER_VIEW)
    // because Ledger precedes Budgeting in nav order.
    expect(href).toBe("/admin/ledger");
  });

  it("returns null for a user with no admin-gating features", () => {
    expect(getFirstAccessibleAdminHref([FEATURES.MEMBERS_VIEW])).toBeNull();
  });

  it("returns null for undefined/empty features", () => {
    expect(getFirstAccessibleAdminHref(undefined)).toBeNull();
    expect(getFirstAccessibleAdminHref([])).toBeNull();
  });

  it("only returns hrefs for items that declare a requiredFeature — System items with none can't be the landing target", () => {
    // Arrange — sanity check on the fixture itself: System group items with no
    // requiredFeature (Email Queue, Sync Log, Release Notes) must stay
    // unreachable as a "first accessible" landing target
    const systemGroup = ADMIN_NAVIGATION.find((g) => g.label === "System");
    const openItems = systemGroup?.items.filter((i) => !i.requiredFeature) ?? [];

    // Act + Assert — fixture still has at least one such item (otherwise this
    // test is vacuous)
    expect(openItems.length).toBeGreaterThan(0);
    expect(getFirstAccessibleAdminHref([])).not.toBe(openItems[0]?.href);
  });
});

// ── getAdminProtectionRules ──────────────────────────────────────────────────
// Regression coverage for the FIFTH instance of the same bug: an admin area
// shipping with a permission narrower than admin.dashboard, but src/proxy.ts
// having no matching protectionRules entry — so the intended user (budget-
// committee twice, ledger, the minutes notetaker, the documents notetaker)
// was bounced to /access-pending before the area's own, correct page-level
// hasFeature() check ever ran. See
// docs/work-log/2026-08-05-admin-area-gating.md and
// docs/work-log/2026-08-09-governance-document-versioning.md (Phase 4
// loop-back). proxy.ts no longer hand-maintains this list — it calls
// getAdminProtectionRules() directly — so these tests exercise exactly what
// proxy.ts uses at runtime, not a parallel copy of it.

describe("getAdminProtectionRules", () => {
  it("every ADMIN_NAVIGATION item with a requiredFeature is admitted by a derived rule matching its own href — the test that would have caught all five prior incidents", () => {
    const rules = getAdminProtectionRules();

    for (const group of ADMIN_NAVIGATION) {
      for (const item of group.items) {
        if (!item.requiredFeature) continue; // System items with no permission of their own — not admission criteria
        if (item.href === "/admin") continue; // bare Dashboard root — intentionally left to proxy.ts's ADMIN_DASHBOARD catch-all, not a segment rule

        const required = Array.isArray(item.requiredFeature) ? item.requiredFeature : [item.requiredFeature];
        const matchingRules = rules.filter((r) => r.pattern.test(item.href));

        // Exactly one derived rule should ever match a given nav item's href
        // — segment patterns are mutually exclusive by construction.
        expect(
          matchingRules.length,
          `expected exactly one derived proxy rule to match "${item.href}" (${item.name}), found ${matchingRules.length}`
        ).toBe(1);

        // Every feature that legitimately unlocks this nav item must be
        // reflected in the matched rule's requiredFeatures — i.e. a user
        // holding ONLY this item's feature(s) would be admitted to the area
        // by proxy.ts, not bounced to /access-pending before the page's own
        // gate ever runs.
        for (const feature of required) {
          expect(
            matchingRules[0].requiredFeatures,
            `"${item.name}" (${item.href}) requires ${feature}, but the derived rule for its area doesn't include it`
          ).toContain(feature);
        }
      }
    }
  });

  it("preserves the exact requiredFeatures set for every admin area that had a hand-written proxy rule before this derivation existed", () => {
    // Regression pin: this is "verify explicitly that each existing area
    // still admits and refuses exactly who it did before" — the exact
    // feature sets src/proxy.ts hand-wrote prior to this refactor.
    const bySegment = new Map(getAdminProtectionRules().map((r) => [r.segment, r]));

    expect(bySegment.get("members")?.requiredFeatures.sort()).toEqual([FEATURES.MEMBERS_EDIT].sort());
    expect(bySegment.get("users")?.requiredFeatures.sort()).toEqual([FEATURES.ADMIN_USERS].sort());
    expect(bySegment.get("roles")?.requiredFeatures.sort()).toEqual([FEATURES.ADMIN_ROLES].sort());
    expect(bySegment.get("permissions")?.requiredFeatures.sort()).toEqual([FEATURES.ADMIN_ROLES].sort());
    expect(bySegment.get("campaigns")?.requiredFeatures.sort()).toEqual([FEATURES.CAMPAIGNS_MANAGE].sort());
    expect(bySegment.get("groups")?.requiredFeatures.sort()).toEqual([FEATURES.GROUPS_MANAGE].sort());
    expect(bySegment.get("ledger")?.requiredFeatures.slice().sort()).toEqual(
      [
        FEATURES.LEDGER_VIEW,
        FEATURES.LEDGER_RECORD,
        FEATURES.LEDGER_MANAGE,
        FEATURES.LEDGER_APPROVE,
        FEATURES.BUDGET_VIEW,
        FEATURES.BUDGET_EDIT,
      ].sort()
    );
    expect(bySegment.get("minutes")?.requiredFeatures.slice().sort()).toEqual(
      [FEATURES.MINUTES_MANAGE, FEATURES.MINUTES_DELETE].sort()
    );
  });

  it("derives a /admin/documents rule requiring DOCUMENTS_MANAGE — the exact gap this loop-back closes", () => {
    const rules = getAdminProtectionRules();
    const documentsRule = rules.find((r) => r.segment === "documents");

    expect(documentsRule).toBeDefined();
    expect(documentsRule?.requiredFeatures).toContain(FEATURES.DOCUMENTS_MANAGE);
    expect(documentsRule?.pattern.test("/admin/documents")).toBe(true);
    expect(documentsRule?.pattern.test("/admin/documents/constitution-bylaws")).toBe(true);
  });

  it("does not let a bounded segment pattern accidentally match a longer sibling segment — /admin/members must not match /admin/membership", () => {
    const rules = getAdminProtectionRules();
    const membersRule = rules.find((r) => r.segment === "members");
    const membershipRule = rules.find((r) => r.segment === "membership");

    expect(membersRule).toBeDefined();
    expect(membershipRule).toBeDefined();

    // The bug this guards: a bare-prefix pattern like /^\/admin\/members/
    // also matches "/admin/membership...", so a request for Applications
    // (membership.manage) would incorrectly be evaluated against the
    // Members area's members.edit requirement instead of its own.
    expect(membersRule?.pattern.test("/admin/membership")).toBe(false);
    expect(membersRule?.pattern.test("/admin/membership/123")).toBe(false);
    expect(membershipRule?.pattern.test("/admin/membership")).toBe(true);
    expect(membershipRule?.requiredFeatures).toEqual([FEATURES.MEMBERSHIP_MANAGE]);

    // And the members segment still matches its own paths correctly.
    expect(membersRule?.pattern.test("/admin/members")).toBe(true);
    expect(membersRule?.pattern.test("/admin/members/123")).toBe(true);
  });

  it("produces no rule for System items with no requiredFeature of their own (Email Queue, Release Notes)", () => {
    const rules = getAdminProtectionRules();
    const segments = rules.map((r) => r.segment);

    expect(segments).not.toContain("email-queue");
    expect(segments).not.toContain("release-notes");
  });

  it("derives a /admin/sync-log rule requiring SYNC_LOG_VIEW — B-41 (docs/backlog.md): this area used to have no requiredFeature at all and relied on the ADMIN_DASHBOARD catch-all, exposing Google Group sync history (real member emails) to any admin.dashboard holder", () => {
    const rules = getAdminProtectionRules();
    const syncLogRule = rules.find((r) => r.segment === "sync-log");

    expect(syncLogRule).toBeDefined();
    expect(syncLogRule?.requiredFeatures).toContain(FEATURES.SYNC_LOG_VIEW);
    expect(syncLogRule?.pattern.test("/admin/sync-log")).toBe(true);
  });

  it("a user holding exactly one area's required feature is admitted by that area's rule and no other unrelated area's rule wrongly admits them", () => {
    const rules = getAdminProtectionRules();
    const documentsRule = rules.find((r) => r.segment === "documents")!;
    const membersRule = rules.find((r) => r.segment === "members")!;

    const notetakerFeatures: FeatureName[] = [FEATURES.DOCUMENTS_MANAGE];

    expect(documentsRule.requiredFeatures.some((f) => notetakerFeatures.includes(f))).toBe(true);
    expect(membersRule.requiredFeatures.some((f) => notetakerFeatures.includes(f))).toBe(false);
  });
});
