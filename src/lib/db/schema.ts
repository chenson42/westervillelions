import { pgTable, text, timestamp, uuid, boolean, integer, date, jsonb, unique, index, type AnyPgColumn } from "drizzle-orm/pg-core";

// Users table for authentication
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  password: text("password"), // hashed password for email/password auth
  image: text("image"),
  role: text("role").notNull().default("member"), // 'admin' | 'member' | 'guest'
  isActive: boolean("is_active").notNull().default(true),
  memberId: uuid("member_id").references((): AnyPgColumn => members.id, { onDelete: "set null" }),
  emailVerified: timestamp("email_verified"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Members table for club members
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberNumber: integer("member_number").unique(), // Lions International member number
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(), // NOT NULL + CI unique enforced via migration 0035
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
  membershipEndedDate: date("membership_ended_date"),
  isActive: boolean("is_active").notNull().default(true),
  duesCategory: text("dues_category").notNull().default("individual"), // 'individual' | 'family'
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
  // mode: "string" — Drizzle returns the raw Postgres "YYYY-MM-DD HH:MM:SS" string
  // rather than constructing a Date object. This is a TypeScript-only annotation;
  // it emits no DDL. See DECISION-005 in docs/decisions.md.
  startDate: timestamp("start_date", { mode: "string" }).notNull(),
  endDate: timestamp("end_date", { mode: "string" }),
  location: text("location"),
  image: text("image"), // Event photo path
  isPublic: boolean("is_public").notNull().default(false), // public events shown on website
  isFeatured: boolean("is_featured").notNull().default(false), // featured on homepage
  requiresRsvp: boolean("requires_rsvp").notNull().default(false),
  maxAttendees: integer("max_attendees"),
  isAllDay: boolean("is_all_day").notNull().default(false),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceType: text("recurrence_type"), // 'weekly' | 'biweekly' | 'monthly'
  recurrenceDays: integer("recurrence_days").array(), // days of week [0=Sun..6=Sat] for weekly/biweekly
  recurrenceEndDate: timestamp("recurrence_end_date", { mode: "string" }), // when the series ends
  allowGuestCount: boolean("allow_guest_count").notNull().default(false),
  // Optional single custom question asked at RSVP/signup time (e.g. "What dish are you bringing?")
  extraQuestion: text("extra_question"),
  extraQuestionType: text("extra_question_type").notNull().default("text"), // 'text' | 'select'
  extraQuestionOptions: jsonb("extra_question_options").$type<string[]>().notNull().default([]),
  extraQuestionRequired: boolean("extra_question_required").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Event RSVPs
export const eventRsvps = pgTable("event_rsvps", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }), // nullable for anonymous RSVPs
  rsvpName: text("rsvp_name"), // for anonymous RSVPs
  rsvpEmail: text("rsvp_email"), // for anonymous RSVPs
  status: text("status").notNull().default("attending"), // 'attending' | 'maybe' | 'declined'
  guestCount: integer("guest_count").notNull().default(0),
  // mode: "string" — same wall-clock treatment as events.startDate. See DECISION-005.
  occurrenceDate: timestamp("occurrence_date", { mode: "string" }),
  extraAnswer: text("extra_answer"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

// Contact form submissions
export const contactSubmissions = pgTable("contact_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  handledBy: text("handled_by"),
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

// Testimonials (public-facing member quotes)
export const testimonials = pgTable("testimonials", {
  id: uuid("id").primaryKey().defaultRandom(),
  quote: text("quote").notNull(),
  authorName: text("author_name").notNull(),
  authorTitle: text("author_title"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Testimonial = typeof testimonials.$inferSelect;
export type NewTestimonial = typeof testimonials.$inferInsert;

// Email queue for persistent delivery with retry support
export const emailQueue = pgTable("email_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  to: text("to").notNull(),
  from: text("from").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'sent' | 'failed'
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  nextRetryAt: timestamp("next_retry_at"),
});

export type EmailQueueItem = typeof emailQueue.$inferSelect;
export type NewEmailQueueItem = typeof emailQueue.$inferInsert;

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

// Audit log of every Google Group sync run
export const googleGroupSyncLog = pgTable("google_group_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupEmail: text("group_email").notNull(),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  triggerSource: text("trigger_source").notNull().default("manual"), // 'manual' | 'member_added' | 'member_removed' | 'member_updated'
  success: boolean("success").notNull(),
  added: jsonb("added").$type<string[]>().notNull().default([]),
  removed: jsonb("removed").$type<string[]>().notNull().default([]),
  failed: jsonb("failed").$type<{ email: string; op: "add" | "remove"; error: string }[]>().notNull().default([]),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type GoogleGroupSyncLog = typeof googleGroupSyncLog.$inferSelect;
export type NewGoogleGroupSyncLog = typeof googleGroupSyncLog.$inferInsert;

// Suggestion box submissions from members
export const suggestions = pgTable("suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  message: text("message").notNull(),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  isRead: boolean("is_read").notNull().default(false),
  handledBy: text("handled_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Suggestion = typeof suggestions.$inferSelect;
export type NewSuggestion = typeof suggestions.$inferInsert;

// Eyeglass drop-off locations (configurable by admin)
export const glassesDropoffLocations = pgTable("glasses_dropoff_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type GlassesDropoffLocation = typeof glassesDropoffLocations.$inferSelect;
export type NewGlassesDropoffLocation = typeof glassesDropoffLocations.$inferInsert;

// Plastic film drop-off locations (configurable by admin)
export const plasticDropoffLocations = pgTable("plastic_dropoff_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone"),
  entryInstructions: text("entry_instructions"),
  hours: text("hours"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PlasticDropoffLocation = typeof plasticDropoffLocations.$inferSelect;
export type NewPlasticDropoffLocation = typeof plasticDropoffLocations.$inferInsert;

// Per-occurrence cancellation overrides for recurring events
export const eventOccurrenceOverrides = pgTable(
  "event_occurrence_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    // Plain date column (YYYY-MM-DD string in JS) — no timezone, no time component.
    // Architecturally locked: see DECISION-001.
    occurrenceDate: date("occurrence_date").notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull(),
    cancelledByUserId: uuid("cancelled_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    cancellationReason: text("cancellation_reason"),
  },
  (t) => [
    unique("event_occurrence_overrides_event_id_occurrence_date_key").on(t.eventId, t.occurrenceDate),
  ]
);

export type EventOccurrenceOverride = typeof eventOccurrenceOverrides.$inferSelect;
export type NewEventOccurrenceOverride = typeof eventOccurrenceOverrides.$inferInsert;

// Dues payment records — one row per payment event per member per fiscal year
export const duesPayments = pgTable(
  "dues_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    // Convention: starting calendar year. FY2026 = Jul 1 2026 – Jun 30 2027 → 2026.
    paymentDate: date("payment_date").notNull(),
    // Wall-clock date of payment (YYYY-MM-DD string in JS). Date-only, no timezone.
    amountCents: integer("amount_cents").notNull(),
    // Integer cents. Negative = refund/reversal. Zero disallowed at app layer.
    method: text("method").notNull(),
    // 'check' | 'cash' | 'zeffy' | 'other'
    notes: text("notes"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_dues_payments_member_fiscal_year").on(t.memberId, t.fiscalYear),
  ],
);

export type DuesPayment = typeof duesPayments.$inferSelect;
export type NewDuesPayment = typeof duesPayments.$inferInsert;

// Dues settings — one row per fiscal year, two amount columns (individual + family)
export const duesSettings = pgTable("dues_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  fiscalYear: integer("fiscal_year").notNull().unique(),
  individualAmountCents: integer("individual_amount_cents").notNull(),
  // Standard annual dues in cents. FY2026 seed: 12000 ($120.00).
  familyAmountCents: integer("family_amount_cents").notNull(),
  // Family/discounted annual dues in cents. FY2026 seed: 9600 ($96.00).
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(false),
  // Only one row may have is_active = true at a time (enforced by partial unique index in migration 0042).
  // The active row determines the default FY shown on all dues surfaces.
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type DuesSettings = typeof duesSettings.$inferSelect;
export type NewDuesSettings = typeof duesSettings.$inferInsert;
