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
 * What it does NOT guarantee: that the gate call uses the *correct* feature,
 * that it's reachable on every code path, or that a component the page
 * renders doesn't itself leak data before the gate runs — those are exactly
 * the class of judgment call the Feature-Gate Audit and qa's manual
 * click-through exist for, not something a source-text regex can verify.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { ADMIN_NAVIGATION } from "./permissions";

const ADMIN_DIR = join(process.cwd(), "src", "app", "(dashboard)", "admin");

// Segments whose primary page.tsx intentionally has no FEATURES gate of its
// own, matching ADMIN_NAVIGATION's own inline comment on AdminNavItem:
// "Omitted entirely for items with no permission of their own (Email Queue,
// Release Notes) — those are visible to any non-admin who already
// cleared the admin-area gate via some other feature." Because these nav
// items declare no requiredFeature, getAdminProtectionRules() derives no
// proxy rule for them either — they fall to src/proxy.ts's generic
// `/^\/admin/` -> ADMIN_DASHBOARD catch-all, which is their real gate.
//
// Email Queue is deliberately NOT on this list even though its nav item also
// has no requiredFeature: its page.tsx chooses its own, stricter ADMIN_USERS
// check anyway, so it's required to pass the same assertion as every gated
// page below.
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
