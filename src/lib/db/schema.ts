import { pgTable, text, timestamp, uuid, boolean, integer, type AnyPgColumn } from "drizzle-orm/pg-core";

// Users table for authentication
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  password: text("password"), // hashed password for email/password auth
  image: text("image"),
  role: text("role").notNull().default("member"), // 'admin' | 'member' | 'guest'
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: timestamp("email_verified"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Members table for club members
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  memberNumber: integer("member_number").unique(), // Lions International member number
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  branch: text("branch"), // Branch/chapter (e.g., "Somali Branch")
  boardPosition: text("board_position"), // Board position (e.g., "President", "Treasurer")
  profilePicture: text("profile_picture"),
  dateOfBirth: text("date_of_birth"), // stored as YYYY-MM-DD
  gender: text("gender"),
  spouseName: text("spouse_name"),
  joinDate: timestamp("join_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Newsletter subscriptions
export const newsletterSubscriptions = pgTable("newsletter_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  isActive: boolean("is_active").notNull().default(true),
  source: text("source").notNull().default("website"),
  subscribedAt: timestamp("subscribed_at").notNull().defaultNow(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Roles table for permission system
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(999), // Lower numbers = higher priority
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// User roles junction table (many-to-many)
export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Features table for granular permissions
export const features = pgTable("features", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // e.g., "members.view", "events.create"
  category: text("category").notNull(), // e.g., "members", "events", "admin"
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Role features junction table (many-to-many)
export const roleFeatures = pgTable("role_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  featureId: uuid("feature_id").notNull().references(() => features.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Permission audit log
export const permissionAuditLog = pgTable("permission_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g., "role_assigned", "permission_granted"
  targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
  targetRoleId: uuid("target_role_id").references(() => roles.id, { onDelete: "set null" }),
  targetFeatureId: uuid("target_feature_id").references(() => features.id, { onDelete: "set null" }),
  details: text("details"), // JSON details
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Password reset tokens
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Campaigns table for Zeffy donation campaigns
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  zeffyLink: text("zeffy_link").notNull(), // Zeffy campaign URL
  image: text("image"), // Campaign image path
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Group types (committees, service teams, branches)
export const groupTypes = pgTable("group_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // e.g., "Committee", "Service Team", "Branch"
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Groups (specific committees, teams, branches)
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupTypeId: uuid("group_type_id").notNull().references(() => groupTypes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"), // Hex color for directory display (e.g. "#1a56db")
  availablePositions: text("available_positions"), // JSON array of position names
  showInDirectory: boolean("show_in_directory").notNull().default(false), // Show group tag on member cards
  showPositionAsTag: boolean("show_position_as_tag").notNull().default(false), // Show position instead of group name as tag
  parentGroupId: uuid("parent_group_id").references((): AnyPgColumn => groups.id, { onDelete: "set null" }), // For hierarchy
  emailPrefix: text("email_prefix"),
  googleGroupSyncedAt: timestamp("google_group_synced_at", { withTimezone: true }),
  googleGroupSyncError: text("google_group_sync_error"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Group roles (Leader, Member, etc.)
export const groupRoles = pgTable("group_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // e.g., "Leader", "Member", "Co-Chair"
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Group memberships (who belongs to which group with what role)
export const groupMemberships = pgTable("group_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  groupRoleId: uuid("group_role_id").notNull().references(() => groupRoles.id, { onDelete: "cascade" }),
  position: text("position"), // Optional position within the group (e.g. "President")
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Events table
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  location: text("location"),
  image: text("image"), // Event photo path
  isPublic: boolean("is_public").notNull().default(false), // public events shown on website
  isFeatured: boolean("is_featured").notNull().default(false), // featured on homepage
  requiresRsvp: boolean("requires_rsvp").notNull().default(false),
  maxAttendees: integer("max_attendees"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceType: text("recurrence_type"), // 'weekly' | 'biweekly' | 'monthly'
  recurrenceDays: integer("recurrence_days").array(), // days of week [0=Sun..6=Sat] for weekly/biweekly
  recurrenceEndDate: timestamp("recurrence_end_date"), // when the series ends
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Event RSVPs
export const eventRsvps = pgTable("event_rsvps", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("attending"), // 'attending' | 'maybe' | 'declined'
  guestCount: integer("guest_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Contact form submissions
export const contactSubmissions = pgTable("contact_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Membership applications
export const membershipApplications = pgTable("membership_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Personal info
  firstName: text("first_name").notNull(),
  middleInitial: text("middle_initial"),
  lastName: text("last_name").notNull(),
  suffix: text("suffix"),
  gender: text("gender"),
  occupation: text("occupation"),
  dateOfBirth: text("date_of_birth"),
  spouseName: text("spouse_name"),
  // Contact info
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  country: text("country").default("USA"),
  phone: text("phone"),
  email: text("email").notNull(),
  // Membership type
  memberType: text("member_type").notNull().default("new"), // new | former | transfer | family | student | leo | young_adult
  sponsorName: text("sponsor_name"),
  previousMemberNumber: text("previous_member_number"),
  previousClubName: text("previous_club_name"),
  previousClubNumber: text("previous_club_number"),
  // Status
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  adminNotes: text("admin_notes"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Homepage announcements (content managed by admins)
export const homepageAnnouncements = pgTable("homepage_announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body"),
  linkUrl: text("link_url"),
  linkLabel: text("link_label"),
  isActive: boolean("is_active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type HomepageAnnouncement = typeof homepageAnnouncements.$inferSelect;
export type NewHomepageAnnouncement = typeof homepageAnnouncements.$inferInsert;

// NextAuth required tables
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionToken: text("session_token").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires").notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull().unique(),
  expires: timestamp("expires").notNull(),
});
