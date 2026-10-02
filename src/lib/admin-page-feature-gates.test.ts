/**
 * Regression coverage for the class of defect behind two real incidents:
 *
 *  - /admin/subscriptions (docs/work-log/2026-08-09-governance-document-versioning.md,
 *    Phase 5 re-verification): DECISION-082 turned src/proxy.ts's admin-area
 *    admission into a derivation from ADMIN_NAVIGATION. The "Newsletter" nav
 *    item declares CONTACT_VIEW, so the proxy correctly admits CONTACT_VIEW
 *    holders to /admin/subscriptions* — but the page itself performed only
 *    an auth() check, no hasFeature() call of any kind, so a contact.view-only
 *    account (no admin.dashboard) could read the full newsletter-subscriber
 *    PII table (names + emails) once the proxy's ADMIN_DASHBOARD catch-all
 *    stopped covering that area.
 *  - /admin/permissions (found during the same audit): pre-existing, not
 *    caused by DECISION-082, but the identical shape — no auth()/hasFeature()
 *    call in the page at all, protected only by the proxy's hand-written
 *    "permissions" rule (ADMIN_ROLES).
 *
 * Both were "the proxy happened to be the only thing standing guard" bugs —
 * exactly the pattern CLAUDE.md's Feature-Gate Audit exists to catch, and
 * exactly the shape a *new* admin page could reintroduce by simply forgetting
 * a hasFeature() call, even with the proxy layer now correctly derived from
 * ADMIN_NAVIGATION (DECISION-082). This suite makes that omission fail CI:
 *
 *  1. Every top-level directory under src/app/(dashboard)/admin/ must have a
 *     matching ADMIN_NAVIGATION entry (closes the "page directory that never
 *     joined the nav" loophole getAdminProtectionRules() itself documents as
 *     NOT guaranteeing anything about).
 *  2. Every such area's page.tsx must itself call hasFeature()/hasAnyFeature()
 *     (or the equivalent inline FEATURES.* check the dashboard root uses) and
 *     must actually redirect() when the check fails — unless the segment is
 *     on the small, explicit allowlist below, which mirrors ADMIN_NAVIGATION's
 *     own documented design for the three areas that intentionally have no
 *     permission of their own (Email Queue*, Sync Log, Release Notes).
 *
 * This is a static-source check, not a live-request test — e2e/admin-
 * subscriptions-page-gate.spec.ts and the sibling *-gate.spec.ts files cover
 * the live-request half. What this test guarantees: an admin page.tsx file
 * with zero permission-gate call anywhere in its source fails this suite.
 *  3. Nav-to-page parity (DECISION-115, B-111): for every ADMIN_NAVIGATION
 *     item, each feature in its requiredFeature must appear in that item's
 *     page.tsx (a page narrower than its nav item bounces a user the proxy
 *     admitted: the Events shape), and a page that gates itself must have a
 *     nav item with a requiredFeature (a permissionless link to a gated page
 *     shows every admin-area user a link that bounces them: the Email Queue
 *     shape). Direction (ii) is deliberately limited to "gated page with
 *     permissionless nav": the reverse (page references no feature absent from
 *     the nav) would be noise, since pages legitimately reference many
 *     FEATURES.* for sub-controls. The shared constants EMAIL_QUEUE_FEATURES
 *     and BUDGET_WRITE_FEATURES count as spelling their member features.
 *     CANNOT see: an inline `canManage` boolean in JSX versus the fetch() a
 *     button triggers, or a runtime role grant. CI does not prove arbitrary
 *     inline control gates match their routes; Phase 5 persona click-through
 *     does.
 *
 * What it does NOT guarantee: that the gate call uses the *correct* feature,
 * that it's reachable on every code path, or that a component the page
 * renders doesn't itself leak data before the gate runs — those are exactly
 * the class of judgment call the Feature-Gate Audit and qa's manual
 * click-through exist for, not something a source-text regex can verify.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  ADMIN_NAVIGATION,
  BUDGET_WRITE_FEATURES,
  EMAIL_QUEUE_FEATURES,
  FEATURES,
  type AdminNavGroup,
  type FeatureName,
} from "./permissions";

const ADMIN_DIR = join(process.cwd(), "src", "app", "(dashboard)", "admin");

// Segments whose primary page.tsx intentionally has no FEATURES gate of its
// own, matching ADMIN_NAVIGATION's own inline comment on AdminNavItem:
// "Omitted entirely for items with no permission of their own (Release
// Notes) — those are visible to any non-admin who already
// cleared the admin-area gate via some other feature." Because these nav
// items declare no requiredFeature, getAdminProtectionRules() derives no
// proxy rule for them either — they fall to src/proxy.ts's generic
// `/^\/admin/` -> ADMIN_DASHBOARD catch-all, which is their real gate.
//
// Email Queue is NOT on this list: it gained EMAIL_QUEUE_MANAGE (DECISION-115)
// and is gated and asserted on like every other page below. The nav-to-page
// parity block at the bottom is what failed when its nav item had no
// requiredFeature while its page gated on ADMIN_USERS.
//
// Sync Log used to be on this list — it was the live PII exposure B-41
// (docs/backlog.md) fixed: any admin.dashboard holder could read Google
// Group sync history including real member email addresses. It now carries
// its own SYNC_LOG_VIEW gate (src/lib/permissions.ts,
// drizzle/migrations/0100_sync_log_view_permission.sql) and is asserted on
// by the generic loop below like every other gated page.
const NO_PAGE_GATE_ALLOWLIST = new Set(["release-notes"]);

const FEATURE_GATE_PATTERN = /hasFeature\(|hasAnyFeature\(|\.includes\(\s*FEATURES\./;

function topLevelAdminSegments(): string[] {
  return readdirSync(ADMIN_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("every top-level admin area is declared in ADMIN_NAVIGATION", () => {
  const segments = topLevelAdminSegments();

  it("the filesystem walk itself found the known areas (sanity check, not a real assertion about gating)", () => {
    expect(segments).toEqual(
      expect.arrayContaining(["subscriptions", "permissions", "ledger", "documents", "sync-log"])
    );
  });

  it.each(segments)(
    "'/admin/%s' has at least one ADMIN_NAVIGATION item whose href is or starts with that path — a page directory absent from the nav entirely has no requiredFeature for getAdminProtectionRules() to read and falls to the ADMIN_DASHBOARD catch-all only by accident, not by design (the one gap DECISION-082's own doc comment names as unclosed)",
    (segment) => {
      const declared = ADMIN_NAVIGATION.some((group) =>
        group.items.some(
          (item) => item.href === `/admin/${segment}` || item.href.startsWith(`/admin/${segment}/`)
        )
      );
      expect(declared).toBe(true);
    }
  );
});

describe("every top-level admin area's page.tsx enforces its own page-level feature gate — regression for /admin/subscriptions and /admin/permissions", () => {
  const segments = topLevelAdminSegments().filter((segment) =>
    existsSync(join(ADMIN_DIR, segment, "page.tsx"))
  );

  it.each(segments.filter((s) => !NO_PAGE_GATE_ALLOWLIST.has(s)))(
    "'/admin/%s/page.tsx' calls hasFeature()/hasAnyFeature() (or an equivalent explicit FEATURES check) — a new admin page shipped with only auth() is exactly the defect class this test exists to catch",
    (segment) => {
      const source = readFileSync(join(ADMIN_DIR, segment, "page.tsx"), "utf-8");
      expect(source).toMatch(FEATURE_GATE_PATTERN);
    }
  );

  it.each(segments.filter((s) => !NO_PAGE_GATE_ALLOWLIST.has(s)))(
    "'/admin/%s/page.tsx' actually enforces the gate with a redirect() — computing a boolean without acting on it is the same defect wearing a disguise",
    (segment) => {
      const source = readFileSync(join(ADMIN_DIR, segment, "page.tsx"), "utf-8");
      expect(source).toMatch(/redirect\(/);
    }
  );

  it.each([...NO_PAGE_GATE_ALLOWLIST])(
    "'/admin/%s' is on the documented no-independent-page-gate allowlist (relies on the proxy's ADMIN_DASHBOARD catch-all — its ADMIN_NAVIGATION item has no requiredFeature, matching the ADMIN_NAVIGATION.AdminNavItem doc comment) and is not itself declared in ADMIN_NAVIGATION with a requiredFeature",
    (segment) => {
      const item = ADMIN_NAVIGATION.flatMap((g) => g.items).find((i) => i.href === `/admin/${segment}`);
      expect(item).toBeDefined();
      expect(item?.requiredFeature).toBeUndefined();
    }
  );

  it("the allowlist contains no segment that ADMIN_NAVIGATION actually gates with a requiredFeature — catches the allowlist going stale if a future change adds a permission to one of these three areas without also removing it here", () => {
    for (const segment of NO_PAGE_GATE_ALLOWLIST) {
      const item = ADMIN_NAVIGATION.flatMap((g) => g.items).find((i) => i.href === `/admin/${segment}`);
      expect(item?.requiredFeature, `expected /admin/${segment} to have no requiredFeature`).toBeUndefined();
    }
  });
});

describe("/admin (dashboard root) enforces its own ADMIN_DASHBOARD gate", () => {
  it("references FEATURES.ADMIN_DASHBOARD and redirects non-holders — this page uses the inline session-features check instead of hasFeature()/hasAnyFeature(), so it's asserted on separately rather than by the generic FEATURE_GATE_PATTERN loop above", () => {
    const source = readFileSync(join(ADMIN_DIR, "page.tsx"), "utf-8");
    expect(source).toMatch(/FEATURES\.ADMIN_DASHBOARD/);
    expect(source).toMatch(/redirect\(/);
  });
});

/**
 * Regression coverage for H1 (2026-09-03 security review): the walk above
 * only ever looked at `<segment>/page.tsx` — the top-level list view for
 * each admin area. It never descended into `<segment>/[id]/page.tsx` or
 * `<segment>/new/page.tsx` (or deeper, e.g. `documents/[slug]/compare`),
 * so those detail/edit/create sub-routes shipped relying solely on
 * `admin/layout.tsx`'s coarse "holds at least one admin feature" gate —
 * exactly the defect class this whole file exists to catch, one directory
 * level deeper than it was checking. Concretely: `/admin/members/[id]`
 * rendered a member's full record (phone, home address) to any signed-in
 * user holding so much as `testimonials.manage`, because nothing between
 * the layout and the page body ever checked `MEMBERS_EDIT`.
 *
 * This walk finds every page.tsx that is NOT a top-level segment's own
 * page.tsx (i.e. more than one directory below ADMIN_DIR) and requires the
 * same hasFeature()/hasAnyFeature() + redirect() pattern the top-level
 * pages must already have.
 */
function nestedAdminPages(): string[] {
  const results: string[] = [];
  function walk(dir: string, depth: number) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name === "page.tsx" && depth > 1) {
        results.push(join(dir, entry.name));
      }
    }
  }
  walk(ADMIN_DIR, 0);
  return results.sort();
}

describe("every nested admin detail/edit/create page ([id], new, and deeper) enforces its own page-level feature gate — regression for H1 (2026-09-03 security review, /admin/members/[id] et al.)", () => {
  const pages = nestedAdminPages();

  it("the filesystem walk itself found the known nested routes (sanity check, not a real assertion about gating)", () => {
    const relative = pages.map((p) => p.slice(ADMIN_DIR.length + 1));
    expect(relative).toEqual(
      expect.arrayContaining([
        join("members", "[id]", "page.tsx"),
        join("members", "new", "page.tsx"),
        join("users", "[id]", "page.tsx"),
      ])
    );
  });

  it.each(pages.map((p) => [p.slice(ADMIN_DIR.length + 1), p] as const))(
    "'admin/%s' calls hasFeature()/hasAnyFeature() (or an equivalent explicit FEATURES check)",
    (_relative, fullPath) => {
      const source = readFileSync(fullPath, "utf-8");
      expect(source).toMatch(FEATURE_GATE_PATTERN);
    }
  );

  it.each(pages.map((p) => [p.slice(ADMIN_DIR.length + 1), p] as const))(
    "'admin/%s' actually enforces the gate with a redirect() — computing a boolean without acting on it is the same defect wearing a disguise",
    (_relative, fullPath) => {
      const source = readFileSync(fullPath, "utf-8");
      expect(source).toMatch(/redirect\(/);
    }
  );
});


// ── Nav-to-page parity (DECISION-115) ────────────────────────────────────────

const FEATURE_KEY_BY_VALUE = new Map<string, string>(
  Object.entries(FEATURES).map(([key, value]) => [value, key])
);

/** Shared constants that spell a set of features; naming one counts as naming each member. */
const FEATURE_CONSTANTS: Record<string, readonly FeatureName[]> = {
  EMAIL_QUEUE_FEATURES,
  BUDGET_WRITE_FEATURES,
};

function sourceSpellsFeature(source: string, feature: FeatureName): boolean {
  const key = FEATURE_KEY_BY_VALUE.get(feature);
  if (key && new RegExp(`FEATURES\\.${key}\\b`).test(source)) return true;
  return Object.entries(FEATURE_CONSTANTS).some(
    ([name, members]) => members.includes(feature) && new RegExp(`\\b${name}\\b`).test(source)
  );
}

/**
 * Pure and exported-in-spirit so the synthetic negative controls below can
 * drive it with fake navs. `readSource(href)` returns the page.tsx source for
 * a nav href, or null when there is none.
 */
function navPageParityViolations(
  nav: AdminNavGroup[],
  readSource: (href: string) => string | null,
  allowlist: ReadonlySet<string> = NO_PAGE_GATE_ALLOWLIST
): string[] {
  const violations: string[] = [];
  for (const group of nav) {
    for (const item of group.items) {
      const source = readSource(item.href);
      if (source === null) {
        violations.push(`${item.href}: no page.tsx found for this nav item`);
        continue;
      }
      const required = item.requiredFeature
        ? Array.isArray(item.requiredFeature)
          ? item.requiredFeature
          : [item.requiredFeature]
        : [];
      for (const feature of required) {
        if (!sourceSpellsFeature(source, feature)) {
          violations.push(
            `${item.href}: nav requires ${feature} but the page never checks it (page narrower than its nav item)`
          );
        }
      }
      const segment = item.href.split("/")[2] ?? "";
      if (required.length === 0 && FEATURE_GATE_PATTERN.test(source) && !allowlist.has(segment)) {
        violations.push(
          `${item.href}: the page gates itself but its nav item has no requiredFeature (every admin-area user sees a link that bounces them)`
        );
      }
    }
  }
  return violations;
}

function readRealPage(href: string): string | null {
  const rel = href.replace(/^\/admin\/?/, "");
  const file = join(ADMIN_DIR, rel, "page.tsx");
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
}

describe("nav-to-page parity (DECISION-115)", () => {
  const nav = (requiredFeature?: FeatureName | FeatureName[]): AdminNavGroup[] => [
    { label: "T", items: [{ name: "X", href: "/admin/x", icon: "x", requiredFeature }] },
  ];

  it("negative control: flags a page narrower than its nav item (the Events shape)", () => {
    const violations = navPageParityViolations(
      nav([FEATURES.EVENTS_EDIT, FEATURES.EVENTS_ANNOUNCE]),
      () => "hasFeature(id, FEATURES.EVENTS_EDIT); redirect('/admin')"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/events\.announce/);
  });

  it("negative control: flags a gated page whose nav item has no requiredFeature (the Email Queue shape)", () => {
    const violations = navPageParityViolations(
      nav(undefined),
      () => "hasFeature(id, FEATURES.ADMIN_USERS); redirect('/admin')"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/no requiredFeature/);
  });

  it("negative control: an allowlisted permissionless segment is not flagged, and a missing page is", () => {
    const allow = new Set(["x"]);
    expect(navPageParityViolations(nav(undefined), () => "hasFeature(", allow)).toEqual([]);
    expect(navPageParityViolations(nav(FEATURES.ADMIN_USERS), () => null)).toHaveLength(1);
  });

  it("a shared constant counts as spelling its members", () => {
    expect(
      navPageParityViolations(
        nav([FEATURES.EMAIL_QUEUE_MANAGE, FEATURES.ADMIN_USERS]),
        () => "hasAnyFeature(id, EMAIL_QUEUE_FEATURES)"
      )
    ).toEqual([]);
  });

  it("passes the real ADMIN_NAVIGATION", () => {
    expect(navPageParityViolations(ADMIN_NAVIGATION, readRealPage)).toEqual([]);
  });
});
