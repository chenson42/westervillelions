/**
 * Feature-based permission system
 *
 * Features represent granular permissions that can be assigned to roles.
 * Always check features (not roles) throughout the application for maximum flexibility.
 */

// Feature constants organized by category
export const FEATURES = {
  // Members features
  MEMBERS_VIEW: "members.view",
  MEMBERS_EDIT: "members.edit",
  MEMBERS_DELETE: "members.delete",

  // Events features
  EVENTS_VIEW: "events.view",
  EVENTS_CREATE: "events.create",
  EVENTS_EDIT: "events.edit",
  EVENTS_DELETE: "events.delete",

  // Campaigns features
  CAMPAIGNS_MANAGE: "campaigns.manage",

  // Groups features
  GROUPS_MANAGE: "groups.manage",

  // Admin features
  ADMIN_DASHBOARD: "admin.dashboard",
  ADMIN_USERS: "admin.users",
  ADMIN_ROLES: "admin.roles",

  // Contact features
  CONTACT_VIEW: "contact.view",

  // Newsletter subscribers (docs/work-log/2026-08-09-governance-document-versioning.md,
  // Phase 4 loop-back 2). Deliberately NOT CONTACT_VIEW: contact.view gates a
  // different dataset (contact-form submissions) with a different seeded
  // description ("View contact form submissions"). The subscriber list is
  // its own bulk-PII dataset (name + email for every newsletter subscriber)
  // and earned its own key rather than reusing a same-shaped-but-wrong one —
  // the same "wrong key, not missing key" pattern DECISION-082 already found
  // and fixed once for /admin/members vs /admin/membership. Bound to the
  // same two roles (admin, board_member) that held contact.view — the only
  // roles that could legitimately reach this page before this key existed —
  // so this is a like-for-like swap, not a widening or narrowing.
  SUBSCRIPTIONS_VIEW: "subscriptions.view",

  // Suggestions features
  SUGGESTIONS_VIEW: "suggestions.view",

  // Announcements features
  ANNOUNCEMENTS_MANAGE: "announcements.manage",

  // Membership features
  MEMBERSHIP_MANAGE: "membership.manage",

  // Reports features
  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",

  // Dues features
  DUES_VIEW: "dues.view",
  DUES_MANAGE: "dues.manage",

  // Ledger features (The Ledger — inc1: Books, inc2: Controls)
  LEDGER_VIEW: "ledger.view",
  LEDGER_RECORD: "ledger.record",
  LEDGER_MANAGE: "ledger.manage",
  LEDGER_APPROVE: "ledger.approve",  // inc2: approve/reject pending disbursements + reimbursements

  // Budget permissions (Budget Committee role) — additive to LEDGER_MANAGE/
  // LEDGER_APPROVE on /admin/ledger/budgeting. No budget.approve key exists
  // by design — lock/approve stays on LEDGER_APPROVE (board-only).
  BUDGET_VIEW: "budget.view",
  BUDGET_EDIT: "budget.edit",

  // Impact / Philanthropy dashboard (The Ledger — inc5: Impact Dashboard)
  IMPACT_VIEW: "impact.view",  // inc5: view member philanthropy/impact dashboard

  // Admin security / failed-login visibility
  ADMIN_SECURITY_VIEW: "admin.security_view",

  // Meeting Minutes (docs/work-log/2026-08-08-meeting-minutes.md,
  // DECISION-074/075/077). No minutes.view/read key exists by design — reading
  // any minutes record, any kind, any status, is open to any linked member.
  MINUTES_MANAGE: "minutes.manage", // create, edit (draft only), approve, reopen
  MINUTES_DELETE: "minutes.delete", // soft-delete / restore — admin only

  // Governance Documents (docs/work-log/2026-08-09-governance-document-versioning.md,
  // DECISION-076/081). No documents.view/read key exists by design — reading
  // the current text and its adopted history is open to any linked member
  // for a visibility: 'members' (or 'public') document, same shape as
  // minutes. No documents.delete key either: every version is a permanent,
  // immutable row — there is no delete path anywhere in this design.
  DOCUMENTS_MANAGE: "documents.manage", // create versions, review/adopt pending amendments, link citing minutes

  // Proposals features (docs/work-log/2026-08-09-project-proposal-form.md, DECISION-084)
  // One key covers both viewing submitted proposals and recording the board's
  // decision — matches DOCUMENTS_MANAGE's precedent (one role authors AND
  // adopts) rather than the Ledger's view/record/approve split, whose
  // separation-of-duties reasoning is money-specific and doesn't transfer to
  // a once-a-month board vote. Explicitly bound below to `admin` +
  // `board_member` by 0085_proposals_permissions.sql — NOT assumed to ride
  // along on any existing binding (board_member does NOT already hold
  // documents.manage/minutes.manage; verified against production).
  PROPOSALS_REVIEW: "proposals.review",

  // Social Media Post Requests (docs/work-log/2026-09-03-social-media-requests.md)
  // One key covers both viewing submitted requests and recording the
  // board's decision — mirrors PROPOSALS_REVIEW's precedent exactly (one
  // role authors and decides; no Ledger-style view/record/approve split,
  // since there's no separation-of-duties reasoning for a marketing
  // request the way there is for money). Explicitly bound below to `admin`
  // + `board_member` by 0093_social_requests_permissions.sql — NOT assumed
  // to ride along on any existing binding.
  SOCIAL_REQUESTS_REVIEW: "social_requests.review",

  // Welcome Packet (docs/work-log/2026-08-21-welcome-packet-live-page.md,
  // DECISION-090). Raw-HTML admin authoring is a documented, narrow
  // exception to DECISION-076 Ruling 3 — the safety argument rests entirely
  // on this key staying admin-only. Do not widen without revisiting
  // DECISION-090. One key covers create, edit, and mark-current — no
  // delete verb exists in this design.
  WELCOME_PACKET_MANAGE: "welcome_packet.manage",
} as const;

// Type for feature names
export type FeatureName = typeof FEATURES[keyof typeof FEATURES];

// Feature categories for organization
export const FEATURE_CATEGORIES = {
  MEMBERS: "members",
  EVENTS: "events",
  CAMPAIGNS: "campaigns",
  GROUPS: "groups",
  ANNOUNCEMENTS: "announcements",
  ADMIN: "admin",
  REPORTS: "reports",
  SUBSCRIPTIONS: "subscriptions",
  DUES: "dues",
  LEDGER: "ledger",
  MINUTES: "minutes",
  DOCUMENTS: "documents",
  PROPOSALS: "proposals",
  WELCOME_PACKET: "welcome_packet",
} as const;

// Helper to get features by category
export function getFeaturesByCategory(category: string): FeatureName[] {
  return Object.values(FEATURES).filter((feature) =>
    feature.startsWith(`${category}.`)
  ) as FeatureName[];
}

// Feature descriptions for UI display
export const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  [FEATURES.MEMBERS_VIEW]: "View member directory and contact information",
  [FEATURES.MEMBERS_EDIT]: "Edit member information and profiles",
  [FEATURES.MEMBERS_DELETE]: "Delete member records",

  [FEATURES.EVENTS_VIEW]: "View events calendar and event details",
  [FEATURES.EVENTS_CREATE]: "Create new events",
  [FEATURES.EVENTS_EDIT]: "Edit existing events",
  [FEATURES.EVENTS_DELETE]: "Delete events",

  [FEATURES.CAMPAIGNS_MANAGE]: "Manage donation campaigns and fundraising",

  [FEATURES.ANNOUNCEMENTS_MANAGE]: "Create, edit, and delete homepage announcements",

  [FEATURES.GROUPS_MANAGE]: "Manage groups, committees, and team memberships",

  [FEATURES.ADMIN_DASHBOARD]: "Access admin dashboard and statistics",
  [FEATURES.ADMIN_USERS]: "Manage user accounts and access",
  [FEATURES.ADMIN_ROLES]: "Manage roles and permissions",

  [FEATURES.CONTACT_VIEW]: "View contact form submissions",

  [FEATURES.SUBSCRIPTIONS_VIEW]: "View the newsletter subscriber list and export subscribers",

  [FEATURES.SUGGESTIONS_VIEW]: "View member suggestion box submissions",

  [FEATURES.MEMBERSHIP_MANAGE]: "View and manage membership applications",

  [FEATURES.REPORTS_VIEW]: "View reports and analytics",
  [FEATURES.REPORTS_EXPORT]: "Export reports and data",

  [FEATURES.DUES_VIEW]: "View annual membership dues status and payment history",
  [FEATURES.DUES_MANAGE]: "Record, edit, and delete dues payments; configure annual dues amounts",

  [FEATURES.LEDGER_VIEW]: "View ledger overview, fund reports, and transaction history",
  [FEATURES.LEDGER_RECORD]: "Record, edit, and delete ledger transactions",
  [FEATURES.LEDGER_MANAGE]:
    "Manage funds, budgets, entities, opening balances, and acknowledgment letter templates",
  [FEATURES.LEDGER_APPROVE]: "Approve and reject pending disbursements and reimbursements",

  [FEATURES.BUDGET_VIEW]: "View budgets",
  [FEATURES.BUDGET_EDIT]: "Create and edit budget line items",

  [FEATURES.IMPACT_VIEW]: "View the member philanthropy and community impact dashboard",

  [FEATURES.ADMIN_SECURITY_VIEW]: "View failed sign-in attempts and account security events",

  [FEATURES.MINUTES_MANAGE]: "Create, edit, approve, and reopen meeting minutes",
  [FEATURES.MINUTES_DELETE]: "Soft-delete and restore meeting minutes",

  [FEATURES.DOCUMENTS_MANAGE]:
    "Create document versions, review pending amendments, adopt substantive changes, and link citing minutes",

  [FEATURES.PROPOSALS_REVIEW]: "View and decide project/activity proposals",

  [FEATURES.SOCIAL_REQUESTS_REVIEW]: "View and decide social media post requests",

  [FEATURES.WELCOME_PACKET_MANAGE]: "Author and publish the member welcome packet",
};

// Default role names (should match database seed data)
export const ROLES = {
  ADMIN: "admin",
  BOARD_MEMBER: "board_member",
  TREASURER: "treasurer",
  MEMBER: "member",
  VOLUNTEER: "volunteer",
  // Pre-existing drift, not introduced by this change: budget_committee is
  // real in the DB (drizzle/migrations/0069_ledger_budget_permissions.sql)
  // but was missing here — added opportunistically while this file was
  // already being touched for `notetaker` (DECISION-074 Invariants note).
  BUDGET_COMMITTEE: "budget_committee",
  // Meeting Minutes (docs/work-log/2026-08-08-meeting-minutes.md) — bound to
  // minutes.manage only; granted manually by an admin, same as every other
  // role today (no auto-derivation from members.boardPosition).
  NOTETAKER: "notetaker",
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];

// ── Admin navigation & area access ──────────────────────────────────────────
// Single source of truth for which admin sidebar sections exist and which
// feature(s) gate each one. AdminSidebar (src/components/admin/admin-sidebar.tsx)
// renders directly from ADMIN_NAVIGATION so the sidebar's visible sections and
// the admin-area access gate below can never drift apart — see
// docs/work-log/2026-08-05-admin-area-gating.md (a budget-committee member with
// budget.edit/budget.view but no admin.dashboard was bounced to /access-pending
// because the admin layout gate only recognized admin.dashboard).

export interface AdminNavItem {
  name: string;
  href: string;
  icon: string;
  // A single feature, or a list where holding ANY one admits the item (e.g.
  // Budgeting: LEDGER_MANAGE, LEDGER_APPROVE, BUDGET_VIEW, or BUDGET_EDIT).
  // Omitted entirely for items with no permission of their own (Email Queue,
  // Sync Log, Release Notes) — those are visible to any non-admin who already
  // cleared the admin-area gate via some other feature, so they cannot be used
  // as an admission criterion themselves.
  requiredFeature?: FeatureName | FeatureName[];
}

export interface AdminNavGroup {
  // null = no header rendered (the standalone Dashboard entry)
  label: string | null;
  items: AdminNavItem[];
}

export const ADMIN_NAVIGATION: AdminNavGroup[] = [
  {
    label: null,
    items: [
      {
        name: "Dashboard",
        href: "/admin",
        icon: "📊",
        requiredFeature: FEATURES.ADMIN_DASHBOARD,
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        name: "Members",
        href: "/admin/members",
        icon: "🦁",
        requiredFeature: FEATURES.MEMBERS_EDIT,
      },
      {
        name: "Users",
        href: "/admin/users",
        icon: "👥",
        requiredFeature: FEATURES.ADMIN_USERS,
      },
      {
        name: "Roles",
        href: "/admin/roles",
        icon: "🔑",
        requiredFeature: FEATURES.ADMIN_ROLES,
      },
      {
        name: "Permissions",
        href: "/admin/permissions",
        icon: "🔒",
        requiredFeature: FEATURES.ADMIN_ROLES,
      },
      {
        name: "Applications",
        href: "/admin/membership",
        icon: "📋",
        requiredFeature: FEATURES.MEMBERSHIP_MANAGE,
      },
      {
        name: "Groups",
        href: "/admin/groups",
        icon: "👨‍👩‍👧‍👦",
        requiredFeature: FEATURES.GROUPS_MANAGE,
      },
    ],
  },
  {
    label: "Treasury",
    // Ordered most-used to least-used for a working treasurer: the Ledger hub
    // is day-to-day, Reconciliation/Reports/Compliance are the monthly review
    // cycle, Dues is a one-month-a-year burst so it sits below those, Donors
    // and Settings are periodic/rare, and the reference guide sits last.
    items: [
      {
        name: "Ledger",
        href: "/admin/ledger",
        icon: "📒",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Reimbursements",
        href: "/admin/ledger/reimbursements",
        icon: "🧾",
        requiredFeature: [
          FEATURES.LEDGER_VIEW,
          FEATURES.LEDGER_RECORD,
          FEATURES.LEDGER_MANAGE,
          FEATURES.LEDGER_APPROVE,
        ],
      },
      {
        name: "Approvals",
        href: "/admin/ledger/approvals",
        icon: "✅",
        requiredFeature: FEATURES.LEDGER_APPROVE,
      },
      {
        name: "Budgeting",
        href: "/admin/ledger/budgeting",
        icon: "🧮",
        requiredFeature: [
          FEATURES.LEDGER_MANAGE,
          FEATURES.LEDGER_APPROVE,
          FEATURES.BUDGET_VIEW,
          FEATURES.BUDGET_EDIT,
        ],
      },
      {
        name: "Reconciliation",
        href: "/admin/ledger/reconciliation",
        icon: "🏦",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Dues",
        href: "/admin/dues",
        icon: "💵",
        requiredFeature: FEATURES.DUES_VIEW,
      },
      {
        name: "Reports",
        href: "/admin/ledger/reports",
        icon: "📊",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Compliance",
        href: "/admin/ledger/compliance",
        icon: "📋",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
      {
        name: "Donors",
        href: "/admin/ledger/donors",
        icon: "🤝",
        requiredFeature: FEATURES.LEDGER_RECORD,
      },
      {
        name: "Ledger Settings",
        href: "/admin/ledger/settings",
        icon: "⚙️",
        requiredFeature: FEATURES.LEDGER_MANAGE,
      },
      {
        name: "User's Guide",
        href: "/admin/ledger/guide",
        icon: "📖",
        requiredFeature: FEATURES.LEDGER_VIEW,
      },
    ],
  },
  {
    label: "Records",
    items: [
      {
        name: "Minutes",
        href: "/admin/minutes",
        icon: "📝",
        // MINUTES_DELETE is admin-only (0080_minutes_permissions.sql binds it
        // to `admin` alone, who bypasses feature checks entirely) and isn't
        // needed to see the nav item itself — but it must still be part of
        // this item's gate-feature set so getAdminProtectionRules() (below)
        // derives the same area-admission set proxy.ts hand-maintained
        // before this file became the single source for it.
        requiredFeature: [FEATURES.MINUTES_MANAGE, FEATURES.MINUTES_DELETE],
      },
      {
        name: "Governing Documents",
        href: "/admin/documents",
        icon: "📜",
        requiredFeature: FEATURES.DOCUMENTS_MANAGE,
      },
      {
        name: "Welcome Packet",
        href: "/admin/welcome-packets",
        icon: "🧳",
        requiredFeature: FEATURES.WELCOME_PACKET_MANAGE,
      },
    ],
  },
  {
    label: "Engagement",
    items: [
      {
        name: "Events",
        href: "/admin/events",
        icon: "📅",
        requiredFeature: FEATURES.EVENTS_EDIT,
      },
      {
        name: "Campaigns",
        href: "/admin/campaigns",
        icon: "💰",
        requiredFeature: FEATURES.CAMPAIGNS_MANAGE,
      },
      {
        name: "Announcements",
        href: "/admin/announcements",
        icon: "📣",
        requiredFeature: FEATURES.ANNOUNCEMENTS_MANAGE,
      },
      {
        name: "Testimonials",
        href: "/admin/testimonials",
        icon: "💬",
        requiredFeature: FEATURES.ANNOUNCEMENTS_MANAGE,
      },
      {
        name: "Programs",
        href: "/admin/programs",
        icon: "👓",
        requiredFeature: FEATURES.ANNOUNCEMENTS_MANAGE,
      },
      {
        name: "Newsletter",
        href: "/admin/subscriptions",
        icon: "📧",
        // SUBSCRIPTIONS_VIEW, not CONTACT_VIEW — see the FEATURES.SUBSCRIPTIONS_VIEW
        // doc comment for why this page earned its own key.
        requiredFeature: FEATURES.SUBSCRIPTIONS_VIEW,
      },
    ],
  },
  {
    label: "Inbox",
    items: [
      {
        name: "Contact",
        href: "/admin/contact",
        icon: "✉️",
        requiredFeature: FEATURES.CONTACT_VIEW,
      },
      {
        name: "Suggestions",
        href: "/admin/suggestions",
        icon: "💡",
        requiredFeature: FEATURES.SUGGESTIONS_VIEW,
      },
      {
        name: "Proposals",
        href: "/admin/proposals",
        icon: "🗂️",
        requiredFeature: FEATURES.PROPOSALS_REVIEW,
      },
      {
        name: "Social Requests",
        href: "/admin/social-requests",
        icon: "📣",
        requiredFeature: FEATURES.SOCIAL_REQUESTS_REVIEW,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        name: "Email Queue",
        href: "/admin/email-queue",
        icon: "📨",
      },
      {
        name: "Sync Log",
        href: "/admin/sync-log",
        icon: "🔄",
      },
      {
        name: "Security",
        href: "/admin/security",
        icon: "🛡️",
        requiredFeature: FEATURES.ADMIN_SECURITY_VIEW,
      },
      {
        name: "Release Notes",
        href: "/admin/release-notes",
        icon: "📝",
      },
    ],
  },
];

// Every feature that gates at least one admin nav item — i.e., the complete set
// of features that can unlock the admin area (including ADMIN_DASHBOARD itself,
// via the Dashboard item).
function getAdminGateFeatures(): FeatureName[] {
  const seen = new Set<FeatureName>();
  for (const group of ADMIN_NAVIGATION) {
    for (const item of group.items) {
      if (!item.requiredFeature) continue;
      const required = Array.isArray(item.requiredFeature)
        ? item.requiredFeature
        : [item.requiredFeature];
      required.forEach((f) => seen.add(f));
    }
  }
  return Array.from(seen);
}

/**
 * True if the user should be able to enter the admin area at all — i.e., they
 * hold at least one feature that gates some admin sidebar section (which
 * includes ADMIN_DASHBOARD, via the Dashboard item itself). This is the single
 * rule used by the admin layout's hard gate and by the header's Admin link, so
 * the two can never disagree about who gets in.
 *
 * Does NOT mean the user can see the /admin stats dashboard specifically —
 * that page has its own narrower ADMIN_DASHBOARD check. See
 * getFirstAccessibleAdminHref for where to send someone who passes this check
 * but doesn't hold ADMIN_DASHBOARD.
 */
export function canAccessAdminArea(features?: string[] | null): boolean {
  const userFeatures = features ?? [];
  if (userFeatures.length === 0) return false;
  return getAdminGateFeatures().some((f) => userFeatures.includes(f));
}

/**
 * The href of the first admin nav item (in ADMIN_NAVIGATION order) the user
 * holds the feature for. Used to land a user who can access the admin area
 * but lacks ADMIN_DASHBOARD somewhere real, instead of the stats dashboard or
 * /access-pending.
 */
export function getFirstAccessibleAdminHref(features?: string[] | null): string | null {
  const userFeatures = features ?? [];
  for (const group of ADMIN_NAVIGATION) {
    for (const item of group.items) {
      if (!item.requiredFeature) continue;
      const required = Array.isArray(item.requiredFeature)
        ? item.requiredFeature
        : [item.requiredFeature];
      if (required.some((f) => userFeatures.includes(f))) return item.href;
    }
  }
  return null;
}

// ── Admin proxy protection rules (derived from ADMIN_NAVIGATION) ───────────
//
// src/proxy.ts's route-admission middleware used to maintain its own
// hand-written list of "which feature(s) let a request reach this admin
// area" in parallel with ADMIN_NAVIGATION. Every time a new admin area
// shipped gated on a permission narrower than admin.dashboard, someone had
// to remember to *also* add a matching proxy rule by hand — and this drifted
// FIVE times running: budget-committee (fixed twice before it stuck),
// /admin/ledger, /admin/minutes, and /admin/documents (see
// docs/work-log/2026-08-05-admin-area-gating.md and
// docs/work-log/2026-08-09-governance-document-versioning.md's Phase 4
// loop-back). Each time, the intended user was bounced to /access-pending by
// the generic ADMIN_DASHBOARD-only catch-all before the area's own, correct
// page-level hasFeature() check ever ran.
//
// getAdminProtectionRules() ends the drift structurally rather than by
// convention: proxy.ts calls this function directly instead of maintaining
// its own list, so there is only ONE list an admin area's gate feature(s)
// can be declared in. Adding a nav item to ADMIN_NAVIGATION with a
// requiredFeature is now sufficient, by construction, to also protect that
// area's URL space at the proxy layer — there is no second place to update
// and forget.
//
// Rules are grouped by the top-level path segment under /admin/ (e.g.
// "ledger", "minutes", "documents") because the proxy's job is coarse
// AREA admission — "may this request reach anything under /admin/ledger at
// all" — not per-page gating; each page underneath still enforces its own
// finer-grained hasFeature() requirement (see the Ledger/Budgeting
// precedent, where the proxy admits any ledger-or-budget feature but
// /admin/ledger/settings itself still requires LEDGER_MANAGE specifically).
// For a segment with multiple nav items (Ledger's eight items, e.g.), the
// derived rule admits ANY feature required by ANY item under that segment —
// the same "any ledger or budget feature" shape the original hand-written
// /admin/ledger rule used.
//
// Segment patterns require a trailing "/" or end-of-string after the
// segment name (not a bare prefix match) so that, e.g., "/admin/members"
// (segment "members") can never also match "/admin/membership" (segment
// "membership") — a real collision the old hand-written
// `/^\/admin\/members/` pattern was silently exposed to (no other rule
// existed for /admin/membership, so it fell through and was governed by the
// members rule's MEMBERS_EDIT requirement instead of Applications' own
// MEMBERSHIP_MANAGE). This derivation fixes that as a side effect of giving
// every segment its own bounded pattern; it does not change matching for
// any path actually under /admin/members/* itself.
//
// Items with no requiredFeature (Email Queue, Sync Log, Release Notes) and
// the bare "/admin" Dashboard root contribute no segment rule — the
// Dashboard root is intentionally left to proxy.ts's generic
// ADMIN_DASHBOARD catch-all, unchanged from before this refactor.
//
// What this DOES guarantee: any ADMIN_NAVIGATION item with a
// `requiredFeature` is automatically proxy-admitted for holders of that
// feature — the specific failure mode behind all five prior incidents
// becomes structurally impossible, not just tested for.
//
// What this does NOT guarantee: if a future admin page is never added to
// ADMIN_NAVIGATION at all (not merely missing a proxy rule, but missing
// from the sidebar's own data entirely), it has no requiredFeature for this
// function to read, and a direct visit still falls to the ADMIN_DASHBOARD
// catch-all. That is a different, so-far-unobserved failure mode (all five
// real incidents involved a nav entry that DID exist) and this change does
// not close it — flagging honestly rather than claiming a guarantee this
// doesn't build. `pnpm test` (see the "every ADMIN_NAVIGATION item..."
// coverage in permissions.test.ts) fails loudly if a nav entry's declared
// feature(s) are ever *not* reflected in the derived rules, which is the
// guarantee this function can actually make.
export interface AdminProtectionRule {
  segment: string;
  pattern: RegExp;
  requiredFeatures: FeatureName[];
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getAdminProtectionRules(): AdminProtectionRule[] {
  const bySegment = new Map<string, Set<FeatureName>>();

  for (const group of ADMIN_NAVIGATION) {
    for (const item of group.items) {
      if (!item.requiredFeature) continue;
      const match = item.href.match(/^\/admin\/([^/]+)/);
      if (!match) continue; // the bare "/admin" Dashboard root — see above
      const segment = match[1];
      const required = Array.isArray(item.requiredFeature) ? item.requiredFeature : [item.requiredFeature];
      const set = bySegment.get(segment) ?? new Set<FeatureName>();
      required.forEach((f) => set.add(f));
      bySegment.set(segment, set);
    }
  }

  return Array.from(bySegment.entries()).map(([segment, features]) => ({
    segment,
    pattern: new RegExp(`^/admin/${escapeRegExpLiteral(segment)}(?:/|$)`),
    requiredFeatures: Array.from(features),
  }));
}
