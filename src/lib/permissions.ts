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
  DUES: "dues",
  LEDGER: "ledger",
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
};

// Default role names (should match database seed data)
export const ROLES = {
  ADMIN: "admin",
  BOARD_MEMBER: "board_member",
  TREASURER: "treasurer",
  MEMBER: "member",
  VOLUNTEER: "volunteer",
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
        requiredFeature: FEATURES.CONTACT_VIEW,
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
