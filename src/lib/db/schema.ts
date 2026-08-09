import { pgTable, text, timestamp, uuid, boolean, integer, date, jsonb, unique, index, uniqueIndex, varchar, customType, type AnyPgColumn } from "drizzle-orm/pg-core";

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
  // 'prospective' | 'active' | 'ended' — server-derived isActive = (membershipStatus === 'active')
  // via isActiveForStatus() in src/lib/members.ts; no route accepts client-submitted isActive.
  // No DB CHECK constraint — consistent with ledger_transactions.status pattern (DECISION-041).
  membershipStatus: text("membership_status").notNull().default("active"),
  duesCategory: text("dues_category").notNull().default("individual"), // 'individual' | 'family'
  // LCI membership TYPE (Active, Member at Large, Honorary, Privileged, Life Member, Associate
  // Member, Affiliate Member) — see MEMBERSHIP_TYPES in src/lib/members.ts. This is NOT club
  // standing (that's membershipStatus, above) and NOT a billing rate (that's duesCategory, above).
  // A member can be type 'life_member' with status 'active', or type 'active' with status 'ended'
  // (an ordinary member who resigned) — the two fields vary independently. No DB CHECK constraint —
  // app-layer enforcement only via isValidMembershipType(), consistent with membershipStatus and
  // duesCategory on this same table (DECISION-041).
  membershipType: text("membership_type").notNull().default("active"),
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

// ─────────────────────────────────────────────────────────────────────────────
// The Ledger — Increment 1: Books
// Two-entity (Club 501c4 / Foundation 501c3) cash-basis accounting system.
// All money is stored as integer cents.  Fiscal year is start-year (DECISION-015).
// Transfers are two linked rows via transferGroupId (DECISION-016/017).
// ─────────────────────────────────────────────────────────────────────────────

// Legal / tax entities (Club = 501c4, Foundation = 501c3)
export const ledgerEntities = pgTable("ledger_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // 'club' | 'foundation'
  name: text("name").notNull(),          // "Westerville Lions Club"
  shortName: text("short_name"),         // "Club" | "Foundation"
  taxClassification: text("tax_classification").notNull(), // '501c4' | '501c3'
  charityStatus: text("charity_status"), // 'public_charity' | 'private_foundation' (Foundation only)
  ein: text("ein"),                      // IRS EIN — placeholder; editable via ledger.manage
  ohioEntityNumber: text("ohio_entity_number"), // Ohio SOS number
  fiscalYearEnd: text("fiscal_year_end").notNull().default("06-30"), // MM-DD
  donationsDeductible: boolean("donations_deductible").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type LedgerEntity = typeof ledgerEntities.$inferSelect;
export type NewLedgerEntity = typeof ledgerEntities.$inferInsert;

// Bank accounts per entity (one or more per entity; signers table deferred to inc2)
export const ledgerBankAccounts = pgTable("ledger_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => ledgerEntities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                // "Chase Checking"
  institution: text("institution"),            // "JPMorgan Chase"
  last4: text("last4"),                        // last four digits of account number
  accountType: text("account_type").notNull().default("checking"), // 'checking' | 'savings' | 'investment'
  requiredSigners: integer("required_signers").notNull().default(2),
  isActive: boolean("is_active").notNull().default(true),
  // The entity's default/operating account — every new transaction (manual
  // entry or dues-sync auto-post) resolves to this account unless the
  // treasurer explicitly overrides it. At most one true per entityId,
  // enforced by a partial unique index (see drizzle/migrations/0070_*).
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type LedgerBankAccount = typeof ledgerBankAccounts.$inferSelect;
export type NewLedgerBankAccount = typeof ledgerBankAccounts.$inferInsert;

// Funds — administrative | activity | charitable | scholarship
export const ledgerFunds = pgTable(
  "ledger_funds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(), // 'administrative' | 'activity' | 'charitable' | 'scholarship'
    name: text("name").notNull(), // "Administrative Fund"
    kind: text("kind").notNull(), // 'administrative' | 'activity' | 'charitable' | 'scholarship'
    openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
    // Placeholder opening balance — set actual value via admin UI under LEDGER_MANAGE.
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_funds_entity_slug_key").on(t.entityId, t.slug),
    index("ix_ledger_funds_entity").on(t.entityId),
  ],
);

export type LedgerFund = typeof ledgerFunds.$inferSelect;
export type NewLedgerFund = typeof ledgerFunds.$inferInsert;

// Categories — income/expense line items, scoped per entity and fund kind
export const ledgerCategories = pgTable(
  "ledger_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fundKind: text("fund_kind").notNull(), // 'administrative' | 'activity' | 'charitable' | 'scholarship'
    flow: text("flow").notNull(),           // 'income' | 'expense'
    name: text("name").notNull(),           // "Club dues"
    form990Line: text("form_990_line"),     // nullable IRS 990 line reference (inc4 prep)
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // false marks categories whose spend is operational/fundraising overhead
    // (e.g. "Fundraising event costs", "Operations", "Insurance & bonding") —
    // excluded from philanthropy/impact reporting even though the money still
    // flows through a giving-eligible fund kind. See DECISION-030.
    countsAsGiving: boolean("counts_as_giving").notNull().default(true),
    // True marks INCOME categories whose transactions will never produce a
    // donor acknowledgment letter — race-entry fees, event receipts, pooled
    // fundraiser deposits, grants, and internal Club<->Foundation transfers,
    // where either the payer received something of value in return or the
    // money isn't an outside gift at all. Excluded from
    // listPendingAcknowledgments() (ledger-queries.ts) regardless of amount.
    // NOT the same axis as countsAsGiving above: countsAsGiving governs
    // OUTBOUND spend counted toward philanthropy/impact reporting; this flag
    // governs INBOUND Foundation income never needing an acknowledgment
    // queued in the first place. Default false preserves every existing
    // category's current behavior (still queued for acknowledgment review).
    // Only meaningful for income categories on a donations-deductible entity
    // (Foundation) — the admin UI only offers the checkbox there, though the
    // column itself has no such constraint (see
    // docs/work-log/2026-08-08-ack-not-required-flag.md).
    ackNotRequired: boolean("ack_not_required").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_ledger_categories_entity_kind_flow").on(t.entityId, t.fundKind, t.flow),
  ],
);

export type LedgerCategory = typeof ledgerCategories.$inferSelect;
export type NewLedgerCategory = typeof ledgerCategories.$inferInsert;

// Ledger Category Management (2026-08-07 / DECISION-065/066): audit trail for
// destructive writes to ledgerCategories (rename, deactivate, reactivate,
// merge, countsAsGiving/form990Line flag edits) — moving these operations out
// of one-off tsx scripts and into an admin UI raised the value of a record of
// who did what considerably (Treasurer Decision 3). Mirrors
// permissionAuditLog's shape above: typed nullable FK columns per target
// kind (targetCategoryId today), not a polymorphic (targetType, targetId)
// pair — that keeps real ON DELETE SET NULL referential integrity instead of
// an unenforced string+uuid pair. Named ledger_audit_log (not
// ledger_category_audit_log) and deliberately schema-generalized ahead of
// need: a future transaction/budget-audit increment adds
// target_transaction_id / target_budget_id to this SAME table via an
// additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration, no rename,
// no second table to reconcile in reports. The code stays un-generalized
// (the audit-write helper lives with its one real caller in
// ledger-category-queries.ts, per DECISION-061) — only the schema pre-pays
// for the stated future need.
//
// before/after hold JSON-stringified diffs of ONLY the fields that changed
// in that call (e.g. a rename-only PATCH writes before: {"name":"Awards"},
// after: {"name":"Member recognition"}), NOT a full-row snapshot of the
// category. This is the difference between an audit log a reviewer can
// actually read at a glance — "what changed, from what, to what" — and one
// that just confirms "category edited" while forcing a diff against some
// other historical record to find out what. Both are null for
// 'category_merged' (a structural two-category re-point, not a field flip;
// its description lives in `details`).
export const ledgerAuditLog = pgTable(
  "ledger_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    // 'category_renamed' | 'category_merged' | 'category_deactivated' |
    // 'category_reactivated' | 'category_flags_updated'
    // ('category_created' is a reserved future value — category creation is
    // NOT audited in v1, per DECISION-066 item 5.)
    action: text("action").notNull(),
    targetCategoryId: uuid("target_category_id").references(() => ledgerCategories.id, { onDelete: "set null" }),
    before: text("before"),
    after: text("after"),
    // Human-readable note: affected fiscal years, merge partner name/id, $ impact.
    details: text("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_ledger_audit_log_category").on(t.targetCategoryId),
    index("ix_ledger_audit_log_created").on(t.createdAt),
  ],
);

export type LedgerAuditLog = typeof ledgerAuditLog.$inferSelect;
export type NewLedgerAuditLog = typeof ledgerAuditLog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// The Ledger — Increment 6a: Donors & Acknowledgments
// ledgerDonors must be defined BEFORE ledgerTransactions because
// ledgerTransactions.donorId has a FK reference to it.
// ─────────────────────────────────────────────────────────────────────────────

// Donors — individuals or orgs that make Foundation gifts subject to IRS Pub 1771.
// Optional link to a club member row; donor PII gated at ledger.record (DECISION-025).
export const ledgerDonors = pgTable("ledger_donors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),      // max 200 chars enforced at app layer
  // Zero or more email addresses, all equal (no labels/primary — treasurer
  // explicitly wants a flat list, not a contact-management model). Replaced
  // the single nullable `email` column (migration 0077, 2026-08-08,
  // docs/work-log/2026-08-08-donor-multiple-emails.md). Each entry is
  // trimmed + lowercased and standard-email-format-validated at the app
  // layer; the array itself has no uniqueness constraint at the DB level
  // (enforced per-donor at the app layer instead).
  emails: text("emails").array().notNull().default([]),
  address: text("address"),          // nullable; max 500 chars at app layer
  memberId: uuid("member_id")
    .references(() => members.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type LedgerDonor = typeof ledgerDonors.$inferSelect;
export type NewLedgerDonor = typeof ledgerDonors.$inferInsert;

// Transactions — the core ledger table.
// flow is 'income' | 'expense' ONLY (DECISION-017).
// Transfers are two linked rows sharing transferGroupId (DECISION-016).
// amountCents is always positive; direction is encoded by flow.
// No fiscalYear column — derived at query time from txnDate (DECISION-015).
// Hard delete in inc1; approvedAt guard added in inc2 for immutability.
// Inc 6a adds: duesPaymentId (dues auto-post idempotency key, DECISION-025),
//              syncStale (out-of-sync marker, DECISION-025),
//              donorId (Foundation income → donor link, DECISION-025).
// Bank Reconciliation inc1 adds: checkNumber (structured check #, text not
// integer, DECISION-034) + composite (bank_account_id, check_number) index.
// Transaction Receipt Upload inc adds: receiptStorageKey (renamed from dead
// receiptUrl paste-URL field) + receiptWaivedAt/receiptWaivedByUserId/
// receiptWaiverReason waiver trio (DECISION-035).
// Impact Gift Public Note inc adds: publicNote (treasurer-curated, member-facing
// annotation, distinct from internal-only memo).
// Bank Reconciliation inc2 adds: reconciledSessionId — pointer to which
// session's close (if any) set reconciled/reconciledAt on this row. NULL for
// rows toggled via the legacy per-row route (out-of-band) or never
// reconciled. Reopen reverts only rows pointing at itself; the legacy toggle
// route clears this to null whenever it fires (out-of-band supersedes
// session provenance). DECISION-036 — modeled on DECISION-025's syncStale: a
// marker, not a parallel status.
export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => ledgerFunds.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id")
      .references(() => ledgerBankAccounts.id, { onDelete: "set null" }),
    txnDate: date("txn_date").notNull(), // wall-clock date; YYYY-MM-DD string in JS
    flow: text("flow").notNull(),         // 'income' | 'expense' — NO 'transfer' value (DECISION-017)
    categoryId: uuid("category_id")
      .references(() => ledgerCategories.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(), // always positive; validated > 0 at app layer
    party: text("party"),          // payer (income) or payee (expense); required for income at app layer
    memo: text("memo"),
    beneficiaryCause: text("beneficiary_cause"), // optional cause taxonomy tag
    // Treasurer-curated, member-facing annotation shown on /members/impact (cause
    // drill-down + Recent Named Gifts). Distinct from `memo`, which stays fully
    // internal. Expense-only at the app layer; 200-char cap enforced server-side
    // (first ledger-transaction text field rendered to members).
    publicNote: text("public_note"),
    paymentMethod: text("payment_method"),        // 'check' | 'cash' | 'zeffy' | 'debit_card' | 'bill_pay' | 'other'
    checkNumber: text("check_number"), // structured check # (T-18); nullable — only checks have one
    // Opaque storage key `receipts/<uuid>/<name>` (DECISION-035); renamed from
    // receipt_url (was a dead paste-URL field, 0/147 non-null — no data migration).
    receiptStorageKey: text("receipt_storage_key"),
    // Waiver — mirrors approvedAt/approvedByUserId/rejectionReason's shape on this
    // table. Nullable trio; all three null = not waived. Un-waive clears all three.
    receiptWaivedAt: timestamp("receipt_waived_at"),
    receiptWaivedByUserId: uuid("receipt_waived_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    receiptWaiverReason: text("receipt_waiver_reason"),
    // transferGroupId links the debit and credit rows of a transfer pair — no FK (self-join key)
    transferGroupId: uuid("transfer_group_id"),
    status: text("status").notNull().default("posted"), // 'posted' | 'pending' | 'rejected' (inc2)
    // Approval / reconcile fields — inc2 sets approvedAt to lock approved rows
    approvedByUserId: uuid("approved_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    boardMinute: text("board_minute"),        // board-minute reference set on approval (inc2)
    rejectionReason: text("rejection_reason"), // reason set on rejection (inc2)
    reconciled: boolean("reconciled").notNull().default(false),
    reconciledAt: timestamp("reconciled_at"),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),
    // Inc 6a: dues auto-post idempotency key — unique, nullable, ON DELETE SET NULL (DECISION-025)
    duesPaymentId: uuid("dues_payment_id")
      .references(() => duesPayments.id, { onDelete: "set null" })
      .unique(),
    // Inc 6a: out-of-sync marker — set true when dues payment edited/deleted after reconcile (DECISION-025)
    syncStale: boolean("sync_stale").notNull().default(false),
    // Inc 6a: donor link — Foundation income → donor record (DECISION-025)
    donorId: uuid("donor_id")
      .references(() => ledgerDonors.id, { onDelete: "set null" }),
    // Bank Reconciliation inc2: provenance pointer — which session's close (if
    // any) set reconciled/reconciledAt on this row (DECISION-036). Forward
    // reference: ledgerReconciliationSessions is defined later in this file,
    // same pattern as users.memberId's forward reference to `members` above.
    reconciledSessionId: uuid("reconciled_session_id").references(
      (): AnyPgColumn => ledgerReconciliationSessions.id,
      { onDelete: "set null" },
    ),
    // Explicit link to a budget line item (B-30, DECISION-061) — nullable, expense-only
    // at the app layer (only expense-flow, giving-eligible categories have lines to point
    // at — see isCauseEligibleCategory). onDelete: 'set null' — collapsing a budget
    // breakdown deletes its ledger_budget_lines rows; a linked transaction survives as
    // simply un-linked, never orphaned/crashing. The UI warns before that happens (see
    // the collapse ConfirmDialog change) but the FK itself is the safety net.
    budgetLineId: uuid("budget_line_id").references(
      (): AnyPgColumn => ledgerBudgetLines.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_ledger_txns_entity_fund").on(t.entityId, t.fundId),
    index("ix_ledger_txns_fund_date").on(t.fundId, t.txnDate),
    index("ix_ledger_txns_status").on(t.status),
    index("ix_ledger_txns_transfer_group").on(t.transferGroupId),
    index("ix_ledger_txns_check_number").on(t.bankAccountId, t.checkNumber),
    index("ix_ledger_txns_reconciled_session").on(t.reconciledSessionId),
    index("ix_ledger_txns_budget_line").on(t.budgetLineId),
  ],
);

export type LedgerTransaction = typeof ledgerTransactions.$inferSelect;
export type NewLedgerTransaction = typeof ledgerTransactions.$inferInsert;

// Acknowledgments — IRS Pub 1771 substantiation records for Foundation donations.
// One acknowledgment per donation transaction (unique on donationTxnId — DECISION-026).
// amountCents is immutable after creation — copied from the transaction at ack time (DECISION-026).
// type: 'written_ack_250' = gift >= $250, no goods/services (or quid-pro-quo FMV < $75)
//        'quid_pro_quo_75' = goods/services with FMV >= $75 provided to donor (stricter — DECISION-026)
export const ledgerAcknowledgments = pgTable(
  "ledger_acknowledgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Foundation income transaction being acknowledged — cascade-delete with the transaction
    donationTxnId: uuid("donation_txn_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "cascade" }),
    // Donor who made the gift — nullable in case the donor record is deleted
    donorId: uuid("donor_id")
      .references(() => ledgerDonors.id, { onDelete: "set null" }),
    // Immutable copy of the transaction's amountCents at ack creation time (DECISION-026)
    amountCents: integer("amount_cents").notNull(),
    // Immutable copy of the transaction's txnDate at ack creation time
    txnDate: date("txn_date").notNull(),
    // 'written_ack_250' | 'quid_pro_quo_75' — auto-derived by deriveAckType(), manual override allowed
    type: text("type").notNull(),
    // Fair-market value of goods/services given to donor; required when type='quid_pro_quo_75'
    quidProQuoValueCents: integer("quid_pro_quo_value_cents"),
    // What the donor received in exchange (e.g. "one Rudolph Run 5K entry").
    // IRS Pub. 1771's quid-pro-quo disclosure requires a DESCRIPTION of the
    // goods/services provided, not just their fair-market value —
    // quidProQuoValueCents alone can't name what was given. Nullable: NULL
    // for legacy rows and for any written_ack_250 ack (no goods/services
    // involved); composeAcknowledgmentLetter() falls back to the generic
    // phrase "goods or services" when null — still accurate, just less
    // specific. See docs/decisions.md DECISION-073 and docs/work-log/
    // 2026-08-08-acknowledgment-letter-generation.md Phase 3.
    quidProQuoDescription: text("quid_pro_quo_description"),
    // null = pending acknowledgment; set to now() when treasurer marks sent
    sentAt: timestamp("sent_at"),
    // Opaque Blob storage key for the uploaded letter file; pattern: acknowledgments/<uuid>/<filename>
    letterStorageKey: text("letter_storage_key"),
    // Free-text alternative to an uploaded letter file
    letterText: text("letter_text"),
    // User who created this acknowledgment record
    recordedByUserId: uuid("recorded_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Defense-in-depth: one acknowledgment per donation transaction (DECISION-026)
    uniqueIndex("ux_ledger_acks_txn").on(t.donationTxnId),
    index("ix_ledger_acks_donor").on(t.donorId),
    index("ix_ledger_acks_sent_at").on(t.sentAt),
  ],
);

export type LedgerAcknowledgment = typeof ledgerAcknowledgments.$inferSelect;
export type NewLedgerAcknowledgment = typeof ledgerAcknowledgments.$inferInsert;

// Acknowledgment letter template — singleton row, mirrors the ledgerSettings
// singleton pattern (DECISION-072 §1).
//
// The five columns below are named "warmth" slots — greeting, thank-you
// body, closing, and signature. They are the ENTIRE writable surface this
// table exposes, and the ENTIRE allowlist the PATCH
// /api/admin/ledger/acknowledgments/letter-template endpoint accepts. That
// is deliberate and load-bearing, not an oversight: this table has NO
// column for the IRS Pub. 1771-required substantiation text (entity name,
// EIN, gift amount, gift date, the no-goods-or-services statement, or the
// quid-pro-quo FMV/deductible-amount statement). That text is never
// treasurer-authored — it is generated fresh at letter-composition time by
// an unexported helper inside src/lib/ledger-acknowledgment-letter.ts from
// ledgerEntities/ledgerAcknowledgments data, a function the template's
// writable columns cannot reach or influence in any way. A treasurer with
// full write access to every column here — including setting all five to
// empty strings — cannot produce a letter missing the required legal
// content, because that content was never stored as editable data to begin
// with. See DECISION-072 §2 and DECISION-073.
//
// No entityId/type column: one shell whose generated section adapts to
// written_ack_250 vs quid_pro_quo_75 at composition time (Treasurer
// Decision 4, 2026-08-08) — not a per-type or per-entity template. No
// version-history table: ledgerAcknowledgments.letterText already snapshots
// the fully-merged letter at generation time (DECISION-026 lineage) and is
// never re-derived from this row after the fact, so editing the template
// cannot retroactively change a letter that was already sent.
export const ledgerLetterTemplates = pgTable("ledger_letter_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  greeting: text("greeting").notNull().default("Dear {{donorName}},"),
  bodyText: text("body_text").notNull().default(
    "On behalf of the Westerville Lions Club Foundation, thank you for your generous gift. " +
      "Your support helps us carry out our mission of serving the Westerville community and " +
      "beyond — from youth scholarships to hunger relief to disaster response. Gifts like yours " +
      "make that work possible.",
  ),
  closing: text("closing").notNull().default("With gratitude,"),
  // Seeds empty, not a fake name — an unset signature is visibly,
  // obviously wrong the moment the treasurer opens the preview, which is
  // the right failure mode (obviously-incomplete beats plausibly-wrong).
  signatureName: text("signature_name").notNull().default(""),
  signatureTitle: text("signature_title").notNull().default("Treasurer, Westerville Lions Club Foundation"),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LedgerLetterTemplate = typeof ledgerLetterTemplates.$inferSelect;
export type NewLedgerLetterTemplate = typeof ledgerLetterTemplates.$inferInsert;

// Budgets — per fund × fiscal year × category × flow
export const ledgerBudgets = pgTable(
  "ledger_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => ledgerFunds.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(), // start year, e.g. 2026 = FY2026 (Jul 2026–Jun 2027)
    categoryId: uuid("category_id")
      .references(() => ledgerCategories.id, { onDelete: "set null" }),
    flow: text("flow").notNull(), // 'income' | 'expense'
    annualAmountCents: integer("annual_amount_cents").notNull(),
    // Star/note annotations (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md).
    // starred: NOT NULL DEFAULT false — pure flag, no meaning tied to amount.
    // note: nullable, no default — null = no note. App-enforced length limit
    // (DECISION-041 precedent, no DB CHECK). Both writable even when the FY
    // budget is Approve-&-locked — see DECISION-057.
    starred: boolean("starred").notNull().default(false),
    note: text("note"),
    // Soft-delete-until-finalize (DECISION-052/053, docs/work-log/2026-07-28-budgeting-page-redesign.md
    // Increment 2). Nullable, no default: null = normal row; set = marked for
    // removal, purged in the same transaction as Approve & lock. Never written
    // alongside annualAmountCents changes — a pure flag-flip.
    pendingDeleteAt: timestamp("pending_delete_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budgets_fund_year_cat_flow_key").on(t.fundId, t.fiscalYear, t.categoryId, t.flow),
    index("ix_ledger_budgets_fund_year").on(t.fundId, t.fiscalYear),
  ],
);

export type LedgerBudget = typeof ledgerBudgets.$inferSelect;
export type NewLedgerBudget = typeof ledgerBudgets.$inferInsert;

// Cause-tagged budget line items — child rows under a ledger_budgets row
// (DECISION-045). A budget row is either a lump sum (no children) or a cause
// breakdown (1+ children whose amounts sum to the parent's annualAmountCents,
// kept in sync by every write path). App-layer valid `cause` values: the
// BUDGET_CAUSES taxonomy + OTHER_COMMUNITY_SUPPORT_CAUSE (src/lib/ledger.ts).
// No DB CHECK/enum — DECISION-041 precedent.
export const ledgerBudgetLines = pgTable(
  "ledger_budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => ledgerBudgets.id, { onDelete: "cascade" }),
    cause: text("cause").notNull(),
    // Free-text label distinguishing multiple lines under the same cause
    // (DECISION-047/048). NOT NULL DEFAULT '' — blank is a real, collidable
    // value ("the one generic line per cause"), not an absence. Every
    // pre-existing v1.40.0 row becomes label='' on migration, i.e. it stays
    // that cause's generic line — no functional change to any row that
    // existed before this migration ran.
    label: text("label").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    // Star/note annotations (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md).
    // Mirrors ledgerBudgets.starred/note exactly — see that table for the full
    // rationale (app-enforced note length, writable even when locked).
    starred: boolean("starred").notNull().default(false),
    note: text("note"),
    // Soft-delete-until-finalize (DECISION-056). Nullable, no
    // default: null = normal row; set = marked for removal, purged in the same transaction
    // as Approve & lock. Mirrors ledgerBudgets.pendingDeleteAt exactly — never written
    // alongside amountCents, so "restore brings the number back exactly" holds by
    // construction, not by special-casing (see setBudgetCauseLinePendingDelete).
    pendingDeleteAt: timestamp("pending_delete_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_lines_budget_cause_label_key").on(t.budgetId, t.cause, t.label),
    index("ix_ledger_budget_lines_budget").on(t.budgetId),
  ],
);

export type LedgerBudgetLine = typeof ledgerBudgetLines.$inferSelect;
export type NewLedgerBudgetLine = typeof ledgerBudgetLines.$inferInsert;

// Budget approve/lock state — one row per (entityId, fiscalYear), unique-
// constrained on that pair. Single status-flip row (DECISION-043), NOT an
// event log: locking sets the approval trio + status='locked'; unlocking
// sets the unlock trio + status='unlocked'. Neither clears the other, so
// the most recent lock and most recent unlock are both visible at once.
export const ledgerBudgetApprovals = pgTable(
  "ledger_budget_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(), // start year, e.g. 2026 = FY2026 — same convention as ledgerBudgets.fiscalYear
    // App-layer valid values: 'locked' | 'unlocked'. No DB CHECK constraint —
    // consistent with ledger_transactions.status / ledger_reimbursements.status
    // (DECISION-041 precedent: enforce in application code, not a DB object
    // schema.ts has no builder for).
    status: text("status").notNull().default("unlocked"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    boardMinute: text("board_minute"),
    unlockedByUserId: uuid("unlocked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    unlockedAt: timestamp("unlocked_at"),
    unlockReason: text("unlock_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_approvals_entity_year_key").on(t.entityId, t.fiscalYear),
    index("ix_ledger_budget_approvals_entity").on(t.entityId),
  ],
);

export type LedgerBudgetApproval = typeof ledgerBudgetApprovals.$inferSelect;
export type NewLedgerBudgetApproval = typeof ledgerBudgetApprovals.$inferInsert;

// Budget-level "Notes & Assumptions" (Budgeting Overview/Drill-Down
// Restructure, DECISION-060) — one free-text note per (entityId, fiscalYear),
// INDEPENDENT of ledgerBudgetApprovals. Deliberately a separate table, not a
// nullable column on ledger_budget_approvals: a draft budget has no approval
// row at all (getBudgetApproval returns null until the first Approve & lock),
// so a note written DURING drafting — the primary use case — needs a home
// that exists before any approval row does. Write path (PATCH
// /api/admin/ledger/budget-notes) gates on LEDGER_MANAGE/BUDGET_EDIT only and
// deliberately NEVER checks the budget lock, mirroring the existing
// category-star/notes precedent (DECISION-057) — commentary isn't a budget
// figure.
export const ledgerBudgetNotes = pgTable(
  "ledger_budget_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(), // start year, e.g. 2026 = FY2026 — same convention as ledgerBudgetApprovals.fiscalYear
    notes: text("notes").notNull().default(""),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_budget_notes_entity_year_key").on(t.entityId, t.fiscalYear),
    index("ix_ledger_budget_notes_entity").on(t.entityId),
  ],
);

export type LedgerBudgetNote = typeof ledgerBudgetNotes.$inferSelect;
export type NewLedgerBudgetNote = typeof ledgerBudgetNotes.$inferInsert;

// Settings — singleton row; guards inc1 guardrail checks (reserves threshold, bonded flag)
export const ledgerSettings = pgTable("ledger_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  philanthropyVisibility: text("philanthropy_visibility").notNull().default("board"), // 'board' | 'members'
  treasurerBonded: boolean("treasurer_bonded").notNull().default(false),
  reserveWarnThresholdCents: integer("reserve_warn_threshold_cents").notNull().default(2500000), // $25,000
  disbApprovalThresholdCents: integer("disb_approval_threshold_cents").notNull().default(25000),  // $250
  retentionYears: integer("retention_years").notNull().default(7),
  holdingPeriodWarnDays: integer("holding_period_warn_days").notNull().default(365),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type LedgerSettings = typeof ledgerSettings.$inferSelect;
export type NewLedgerSettings = typeof ledgerSettings.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────
// The Ledger — Bank Reconciliation inc2: sessions, bank lines, match links
// Session close writes the SAME ledgerTransactions.reconciled/reconciledAt
// columns the legacy per-row toggle writes (architect Ruling 3, parent
// work-log Phase 2 §3) — reconciledSessionId (added to ledgerTransactions,
// below) is a provenance pointer, not a parallel status. DECISION-036.
// Timestamp columns here use { withTimezone: true } (timestamptz) — the
// current convention for newly-added tables (see ledgerFilings,
// failedLoginAttempts), diverging deliberately from this file's older
// ledger tables (ledgerEntities..ledgerReimbursements), which predate that
// convention and remain naive timestamps.
// ─────────────────────────────────────────────────────────────────────────

export const ledgerReconciliationSessions = pgTable(
  "ledger_reconciliation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => ledgerBankAccounts.id, { onDelete: "cascade" }),
    statementPeriodStart: date("statement_period_start").notNull(),
    statementPeriodEnd: date("statement_period_end").notNull(),
    openingBalanceCents: integer("opening_balance_cents").notNull(),
    closingBalanceCents: integer("closing_balance_cents").notNull(),
    status: text("status").notNull().default("open"), // 'open' | 'closed'
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    csvFilename: text("csv_filename"), // display-only; the file itself is never stored (parse-and-discard)
    csvRowCount: integer("csv_row_count"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: uuid("closed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Last-reopen-only (current state, not an append-only log — mirrors the
    // receipt-waiver trio's precedent, DECISION-035). Cleared on re-close.
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedByUserId: uuid("reopened_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Defense-in-depth: exact-duplicate period for the same account rejected
    // at the DB layer too, not just by the route's overlap check.
    unique("ledger_recon_sessions_account_period_key").on(
      t.bankAccountId,
      t.statementPeriodStart,
      t.statementPeriodEnd,
    ),
    index("ix_ledger_recon_sessions_account").on(t.bankAccountId, t.statementPeriodEnd),
  ],
);
export type LedgerReconciliationSession = typeof ledgerReconciliationSessions.$inferSelect;
export type NewLedgerReconciliationSession = typeof ledgerReconciliationSessions.$inferInsert;

export const ledgerBankLines = pgTable(
  "ledger_bank_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => ledgerReconciliationSessions.id, { onDelete: "cascade" }),
    // Denormalized from the session for query convenience (e.g. a future
    // cross-session audit query) — not used for cross-session dedupe, which
    // is unnecessary given overlap is blocked at session creation.
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => ledgerBankAccounts.id, { onDelete: "cascade" }),
    postingDate: date("posting_date").notNull(),
    description: text("description").notNull(), // raw Chase text; no import-time escaping (see design doc Edge Cases)
    // SIGNED — positive=credit, negative=debit (Chase's own convention; deliberate
    // divergence from ledgerTransactions' positive-only + flow model).
    amountCents: integer("amount_cents").notNull(),
    rawType: text("raw_type"), // Chase "Type" column, kept as-is (e.g. "ACH_DEBIT")
    // Chase's own "Check or Slip #" column, verbatim. Meaning depends on sign
    // (deposit-slip-vs-check-number split, DECISION-036) — never split into two columns.
    checkOrSlipNumber: text("check_or_slip_number"),
    balanceCents: integer("balance_cents"), // Chase's running balance; display-only, not used in tie-out math
    inStatementPeriod: boolean("in_statement_period").notNull().default(true),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ledger_bank_lines_session_dedupe_key").on(t.sessionId, t.dedupeKey),
    index("ix_ledger_bank_lines_session_period").on(t.sessionId, t.inStatementPeriod),
    index("ix_ledger_bank_lines_check_slip").on(t.bankAccountId, t.checkOrSlipNumber), // shape inc3's auto-match will need
  ],
);
export type LedgerBankLine = typeof ledgerBankLines.$inferSelect;
export type NewLedgerBankLine = typeof ledgerBankLines.$inferInsert;

export const ledgerReconciliationMatches = pgTable(
  "ledger_reconciliation_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => ledgerReconciliationSessions.id, { onDelete: "cascade" }),
    bankLineId: uuid("bank_line_id")
      .notNull()
      .references(() => ledgerBankLines.id, { onDelete: "cascade" }),
    // UNIQUE forever — one book transaction clears against exactly one bank
    // line, even after inc3's Zeffy batch matching. bankLineId is
    // deliberately NOT unique — a future batch match links many transactions
    // to one bank line; inc2's /match route enforces 1:1 at the route layer
    // only, so inc3 can lift that route-level restriction with zero schema
    // change (DECISION-036).
    transactionId: uuid("transaction_id")
      .notNull()
      .unique()
      .references(() => ledgerTransactions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [index("ix_ledger_recon_matches_bank_line").on(t.bankLineId)],
);
export type LedgerReconciliationMatch = typeof ledgerReconciliationMatches.$inferSelect;
export type NewLedgerReconciliationMatch = typeof ledgerReconciliationMatches.$inferInsert;

// Reimbursement requests — member self-service submission; requires board approval before payment.
// Lifecycle: submitted → approved | rejected → paid.
// Marking paid creates a linked ledger_transactions row (flow='expense', status='posted').
// No CHECK constraint on status — consistent with ledger_transactions.status pattern (inc1 precedent).
// DECISION-020: receipt_storage_key stores an opaque provider-neutral key, never a URL.
export const ledgerReimbursements = pgTable(
  "ledger_reimbursements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Member who submitted the request — cascade-delete if the member is deleted
    submittedByMemberId: uuid("submitted_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    // User account of the submitter
    submittedByUserId: uuid("submitted_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),
    amountCents: integer("amount_cents").notNull(),          // always positive; validated > 0 at app layer
    description: text("description").notNull(),              // max 1000 chars at app layer
    beneficiaryCause: text("beneficiary_cause"),             // optional cause tag (member-supplied)
    // Opaque storage key (DECISION-020); not a URL. Pattern: receipts/<uuid>/<filename>
    receiptStorageKey: text("receipt_storage_key").notNull(),
    // Treasurer assigns the fund at pay time (R-3); null until then
    fundId: uuid("fund_id")
      .references(() => ledgerFunds.id, { onDelete: "set null" }),
    // App-layer valid values: 'submitted' | 'approved' | 'rejected' | 'paid'
    // No DB CHECK constraint — consistent with ledger_transactions.status (inc1 precedent)
    status: text("status").notNull().default("submitted"),
    reviewedByUserId: uuid("reviewed_by_user_id")
      .references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    boardMinute: text("board_minute"),                       // required when approving
    rejectionReason: text("rejection_reason"),               // required when rejecting
    paidAt: timestamp("paid_at"),
    // FK to the expense transaction created when treasurer marks paid; null until paid
    ledgerTransactionId: uuid("ledger_transaction_id")
      .references(() => ledgerTransactions.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_ledger_reimb_member").on(t.submittedByMemberId),
    index("ix_ledger_reimb_status").on(t.status),
  ],
);

export type LedgerReimbursement = typeof ledgerReimbursements.$inferSelect;
export type NewLedgerReimbursement = typeof ledgerReimbursements.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// The Ledger — Increment 3: Compliance
// Per-entity per-fiscal-year compliance filings calendar.
// Due dates are stored as month/day pairs and computed at query time via
// computeDueDate(fiscalYear, dueMonth, dueDay) — DECISION-021.
// 5-year recurrence cadence controlled by nextDueYear — DECISION-022.
// ─────────────────────────────────────────────────────────────────────────────

export const ledgerFilings = pgTable(
  "ledger_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => ledgerEntities.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    // FY start year (e.g. 2026 = Jul 2026 – Jun 2027)
    agency: text("agency").notNull(),
    // 'IRS' | 'Ohio Attorney General' | 'Ohio Secretary of State' |
    // 'Ohio Dept. of Commerce' | 'Internal — Audit Committee'
    title: text("title").notNull(),
    // Human display name, e.g. '990-N', 'Ohio AG Annual Report'
    dueMonth: integer("due_month").notNull(),
    // 1–12; combined with dueDay + fiscalYear to derive the absolute due date:
    // month >= 7 → new Date(fiscalYear, dueMonth-1, dueDay)
    // month < 7  → new Date(fiscalYear+1, dueMonth-1, dueDay)
    dueDay: integer("due_day").notNull(),
    // 1–31
    recurrence: text("recurrence").notNull().default("annual"),
    // 'annual' | '5_year'
    nextDueYear: integer("next_due_year"),
    // Non-null only for recurrence='5_year'. Stores the calendar year in which
    // this specific row's due date falls (DECISION-022). listFilings includes
    // a 5-year row only when nextDueYear === (dueMonth >= 7 ? fiscalYear : fiscalYear+1).
    status: text("status").notNull().default("not_started"),
    // 'not_started' | 'in_progress' | 'filed' | 'future' | 'na'
    // No DB CHECK constraint — consistent with ledger_transactions.status (inc1 precedent).
    confirmation: text("confirmation"),
    // Agency confirmation/acknowledgment code; max 100 chars at app layer
    filedOn: date("filed_on"),
    // Wall-clock date filed; required when status → 'filed' (enforced at app layer)
    note: text("note"),
    // Max 1000 chars at app layer
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("ledger_filings_entity_fy_agency_title_key").on(
      t.entityId,
      t.fiscalYear,
      t.agency,
      t.title,
    ),
    index("ix_ledger_filings_entity_fy").on(t.entityId, t.fiscalYear),
  ],
);

export type LedgerFiling = typeof ledgerFilings.$inferSelect;
export type NewLedgerFiling = typeof ledgerFilings.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Failed Login Visibility
// Append-only audit log of failed sign-in attempts (Credentials + Google
// OAuth-deactivated denials). Passive recording only — see
// src/lib/auth/failed-login.ts for the recorder, enums, and opportunistic
// 90-day prune. DECISION-033.
// ─────────────────────────────────────────────────────────────────────────────

export const failedLoginAttempts = pgTable(
  "failed_login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptedEmail: varchar("attempted_email", { length: 255 }).notNull(),
    provider: text("provider").notNull(), // 'credentials' | 'google'
    reason: text("reason").notNull(), // see FAILED_LOGIN_REASONS in src/lib/auth/failed-login.ts
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ix_failed_login_attempts_created_at").on(t.createdAt),
    index("ix_failed_login_attempts_email").on(t.attemptedEmail),
  ],
);

export type FailedLoginAttempt = typeof failedLoginAttempts.$inferSelect;
export type NewFailedLoginAttempt = typeof failedLoginAttempts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Receipt Storage in the Database — DECISION-040
// Bytes for ledger transaction receipts, reimbursement receipts, and
// acknowledgment letters, keyed by the existing opaque
// `receipts/<uuid>/<name>` / `acknowledgments/<uuid>/<name>` key (DECISION-020
// format, unchanged). Deliberately a side table, not a bytea column on
// ledger_transactions/ledger_reimbursements/ledger_acknowledgments — keeps
// those hot, frequently-SELECT *'d rows narrow (same reasoning that produced
// ledger_filings, ledger_reconciliation_matches, etc. as side tables).
// created_at is NOT re-stamped on ON CONFLICT DO UPDATE (see
// DatabaseReceiptStorage.save()) — first-write-wins for the timestamp,
// deliberate per architect Suggestion.
// ─────────────────────────────────────────────────────────────────────────────

/** First binary column in this schema. driverData/data both Buffer — postgres.js decodes bytea to Buffer natively, no custom to/fromDriver mapping needed. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const ledgerReceiptFiles = pgTable("ledger_receipt_files", {
  key: text("key").primaryKey(), // receipts/<uuid>/<name> or acknowledgments/<uuid>/<name> — DECISION-020 format
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerReceiptFile = typeof ledgerReceiptFiles.$inferSelect;
export type NewLedgerReceiptFile = typeof ledgerReceiptFiles.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Meeting Minutes — DECISION-074/075 (architect), DECISION-077 (tech-lead),
// DECISION-079 (Phase 4 loop-back: attendance is a single count, not a roster)
// docs/work-log/2026-08-08-meeting-minutes.md
//
// One parent table (minutes) + two child tables (motions, action items).
// Deliberately NOT part of the `ledger_*` family — DECISION-074 Ruling 2 is
// explicit that minutes shares no tables, permission keys, or audience
// boundary with the Ledger. Read access is universal (any linked member, any
// kind, any status) — there is no minutes.view/read gate by design. Write
// access is gated by minutes.manage (create/edit/approve/reopen) and
// minutes.delete (soft-delete/restore only), added in the companion permission
// migration 0080_minutes_permissions.sql via the notetaker role.
//
// DECISION-079 superseded the original per-member `minutesAttendance` child
// table (roster checklist, memberId FK, memberNameSnapshot) — the treasurer
// clarified the actual requirement was "a single count number for
// attendance," not a per-member roster fact. That table never shipped (the
// migration adding it was never committed), so it was removed outright
// rather than deprecated — see `presentCount` below.
// ─────────────────────────────────────────────────────────────────────────────

export const minutes = pgTable(
  "minutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Open-ended, DECISION-041 pattern: plain text, no DB CHECK/enum. Validated
    // against MINUTES_KINDS in src/lib/minutes.ts. Adding a new kind (e.g. a
    // new ad hoc committee) is a one-line const change + deploy — it must NEVER
    // require a migration. Same shape as ledger_budget_lines.cause.
    kind: text("kind").notNull(),
    // Nullable — not every record ties to a scheduled event occurrence (ad hoc
    // or historical minutes can exist with no matching events row).
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    // `date`, NOT `timestamp` — deliberate, and NOT copied from
    // eventRsvps.occurrenceDate, which is a naive timestamp("...", { mode:
    // "string" }) column with a known, previously-tripped-over bug (12:30 PM
    // wall-clock reads back as 8:30 AM in EDT because it's silently treated as
    // UTC). A minutes record belongs to a calendar day, not a wall-clock
    // instant — same reasoning DECISION-001 already used for
    // event_occurrence_overrides.occurrence_date. Do NOT "fix" this to
    // timestamp later; that would reintroduce the exact bug this column type
    // was chosen to avoid. When eventId is set this is that occurrence's
    // calendar date; when null the notetaker enters it directly.
    meetingDate: date("meeting_date").notNull(),
    // DECISION-041 pattern: 'draft' | 'approved', validated in src/lib/minutes.ts.
    status: text("status").notNull().default("draft"),
    // Optional disambiguation label (e.g. "Officer Elections") for the rare case
    // of two minutes records sharing a kind + meetingDate (no unique constraint
    // forbids this — see below). UI falls back to "{kind} minutes — {meetingDate}"
    // when null.
    title: text("title"),
    // A single headcount of members present, not a per-member roster —
    // DECISION-079 (Phase 4 loop-back). Nullable: a set of minutes may
    // legitimately not record a count at all (an ad hoc/historical record,
    // or simply not taken that meeting). Deliberately NOT tied to `members`
    // in any way — the treasurer's own framing, "attendance should have
    // nothing to do with members records," taken literally. A future
    // quorum check (still not built, by design — Phase 1) would consume
    // this count directly against the by-laws' "majority of the members in
    // good standing" threshold for a regular meeting.
    presentCount: integer("present_count"),
    // Notetaker of record — WHO TOOK THE MINUTES, per governance convention
    // that minutes name their recorder. Distinct from authorUserId below,
    // which is data-entry attribution only (whoever typed the record into
    // the app) and is never displayed. The secretary may take notes on
    // paper and someone else types them up later, or a substitute may cover
    // a meeting — the two people are frequently different.
    //
    // Follows the pattern the schema already got right for attendance
    // (nullable member FK + ON DELETE SET NULL, paired with a name snapshot
    // that is the display source of truth): notetakerMemberId is nullable
    // and degrades gracefully if the member is later hard-deleted;
    // notetakerNameSnapshot is written once, from the submitted payload, at
    // create/update time — it is NEVER recomputed from, or invalidated by,
    // the current roster. A notetaker who later resigns must still show as
    // the notetaker of that meeting, forever; a hard member-delete only
    // nulls the FK, the name snapshot survives untouched.
    //
    // Both columns are nullable, unlike minutesAttendance's old NOT NULL
    // snapshot — that NOT NULL was safe there because an attendance ROW only
    // ever existed once a member had been picked (the row's existence
    // implied a name). Here the notetaker is one optional field on a row
    // that always exists regardless of whether a notetaker was ever
    // recorded — historical minutes entered later may have no clear record
    // of who took them, and forcing a value would produce false data, not
    // real accountability.
    notetakerMemberId: uuid("notetaker_member_id").references(() => members.id, { onDelete: "set null" }),
    notetakerNameSnapshot: text("notetaker_name_snapshot"),
    bodyMarkdown: text("body_markdown"),
    // Data-entry attribution ONLY — who created/is editing this row, not who
    // took the notes (that's notetakerMemberId/notetakerNameSnapshot above).
    // Never displayed in any UI or the emailed version; kept for internal
    // accountability only (mirrors every other *_user_id attribution column
    // in this schema).
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    // Column SHAPE reused from ledgerBudgets.pendingDeleteAt (nullable timestamp,
    // flag-flip, restorable) — the PURGE behavior is explicitly NOT reused.
    // ledgerBudgets purges pending-delete rows in the same transaction as
    // Approve & lock, a budget-specific finalize event minutes has no
    // equivalent of. Meeting minutes are a permanent governance record (IRS
    // guidance treats board minutes as core records retained forever) — a
    // soft-deleted minutes row must stay in the database indefinitely, hidden
    // from every read path, restorable by admin. There is no purge path for
    // this table anywhere in the app; if a true hard-delete is ever genuinely
    // needed it is a separate, rare, manual-only action, not this column.
    pendingDeleteAt: timestamp("pending_delete_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // No unique(kind, meetingDate) — two sets of minutes for one meeting (a
    // split session, or a re-do) must be representable. DECISION-077 §9;
    // read-time queries (next-meeting pointer, most-recent-approved) resolve
    // the ambiguity by preferring status='approved' and breaking ties by most
    // recent approvedAt/createdAt, rather than the schema forbidding it.
    index("ix_minutes_kind").on(t.kind),
    index("ix_minutes_meeting_date").on(t.meetingDate),
    index("ix_minutes_event").on(t.eventId),
    index("ix_minutes_status").on(t.status),
    index("ix_minutes_notetaker").on(t.notetakerMemberId),
  ],
);

export type Minutes = typeof minutes.$inferSelect;
export type NewMinutes = typeof minutes.$inferInsert;

export const minutesMotions = pgTable(
  "minutes_motions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    minutesId: uuid("minutes_id").notNull().references(() => minutes.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    // Free text, NOT a members FK — DECISION-077 §2. A mover/seconder can be a
    // guest, and unlike attendance, this club has no stated need to ever query
    // motions by member identity. Forcing a member-picker here would be the
    // over-structuring failure mode the brief warned against.
    moverName: text("mover_name").notNull(),
    seconderName: text("seconder_name"), // nullable — small bodies don't always formally second
    // DECISION-041 pattern: 'passed' | 'failed' | 'tabled' | 'withdrawn',
    // validated against MOTION_RESULTS in src/lib/minutes.ts.
    result: text("result").notNull().default("passed"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ix_minutes_motions_minutes").on(t.minutesId)],
);

export type MinutesMotion = typeof minutesMotions.$inferSelect;
export type NewMinutesMotion = typeof minutesMotions.$inferInsert;

export const minutesActionItems = pgTable(
  "minutes_action_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    minutesId: uuid("minutes_id").notNull().references(() => minutes.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    ownerName: text("owner_name").notNull(), // free text — same reasoning as motions above, DECISION-077 §2
    dueDate: date("due_date"), // nullable — some action items are "ongoing" / "before next meeting"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("ix_minutes_action_items_minutes").on(t.minutesId)],
);

export type MinutesActionItem = typeof minutesActionItems.$inferSelect;
export type NewMinutesActionItem = typeof minutesActionItems.$inferInsert;
