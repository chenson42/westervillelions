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

  // Reports features
  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",
} as const;

// Type for feature names
export type FeatureName = typeof FEATURES[keyof typeof FEATURES];

// Feature categories for organization
export const FEATURE_CATEGORIES = {
  MEMBERS: "members",
  EVENTS: "events",
  CAMPAIGNS: "campaigns",
  GROUPS: "groups",
  ADMIN: "admin",
  REPORTS: "reports",
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

  [FEATURES.GROUPS_MANAGE]: "Manage groups, committees, and team memberships",

  [FEATURES.ADMIN_DASHBOARD]: "Access admin dashboard and statistics",
  [FEATURES.ADMIN_USERS]: "Manage user accounts and access",
  [FEATURES.ADMIN_ROLES]: "Manage roles and permissions",

  [FEATURES.CONTACT_VIEW]: "View contact form submissions",

  [FEATURES.REPORTS_VIEW]: "View reports and analytics",
  [FEATURES.REPORTS_EXPORT]: "Export reports and data",
};

// Default role names (should match database seed data)
export const ROLES = {
  ADMIN: "admin",
  BOARD_MEMBER: "board_member",
  MEMBER: "member",
  VOLUNTEER: "volunteer",
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];
