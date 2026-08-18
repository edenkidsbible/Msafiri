/**
 * ops.ts — Drizzle schema for the Msafiri Operations platform.
 *
 * All tables are prefixed `ops_` so they coexist safely with the existing
 * app-management schema.  The "users" in this context are the same people
 * as admin_users — we reference adminUsersTable.id as a TEXT FK rather than
 * importing the table to avoid circular deps.
 */

import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  numeric,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

// ─── DEPARTMENTS ──────────────────────────────────────────────────────────────

export const opsDepartmentsTable = pgTable("ops_departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TEAM MEMBERS (admin_user_id → ops_department) ────────────────────────────

export const opsTeamMembersTable = pgTable("ops_team_members", {
  id: serial("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(), // references admin_users.id
  departmentId: integer("department_id").references(() => opsDepartmentsTable.id, { onDelete: "set null" }),
  role: text("role").notNull().default("member"), // founder | admin | member | viewer
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  invitedBy: text("invited_by"), // admin_users.id of who added this member
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── INVITATIONS ──────────────────────────────────────────────────────────────

export const opsInvitationsTable = pgTable("ops_invitations", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  departmentId: integer("department_id").references(() => opsDepartmentsTable.id, { onDelete: "set null" }),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("pending"), // pending | accepted | expired | revoked
  invitedBy: text("invited_by"), // admin_users.id
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── OPERATING WEEKS ──────────────────────────────────────────────────────────

export const opsOperatingWeeksTable = pgTable("ops_operating_weeks", {
  id: serial("id").primaryKey(),
  weekNumber: integer("week_number").notNull().unique(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  plannedCashInKes: numeric("planned_cash_in_kes", { precision: 15, scale: 2 }),
  plannedCashOutKes: numeric("planned_cash_out_kes", { precision: 15, scale: 2 }),
  plannedEndingCashKes: numeric("planned_ending_cash_kes", { precision: 15, scale: 2 }),
  actualCashInKes: numeric("actual_cash_in_kes", { precision: 15, scale: 2 }),
  actualCashOutKes: numeric("actual_cash_out_kes", { precision: 15, scale: 2 }),
  actualEndingCashKes: numeric("actual_ending_cash_kes", { precision: 15, scale: 2 }),
  varianceKes: numeric("variance_kes", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opsWeeklyPlansTable = pgTable("ops_weekly_plans", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id").notNull().references(() => opsOperatingWeeksTable.id),
  mainObjective: text("main_objective"),
  requiredOutcomes: text("required_outcomes").array(),
  completedOutcomes: text("completed_outcomes").array(),
  cashDecision: text("cash_decision"),
  productPriority: text("product_priority"),
  userPriority: text("user_priority"),
  fieldSprint: text("field_sprint"),
  contentPlan: text("content_plan"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const opsWeeklyReviewsTable = pgTable("ops_weekly_reviews", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id").notNull().references(() => opsOperatingWeeksTable.id),
  whatWorked: text("what_worked"),
  whatDidntWork: text("what_didnt_work"),
  keyLearning: text("key_learning"),
  nextWeekFocus: text("next_week_focus"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

// ─── FINANCE ──────────────────────────────────────────────────────────────────

export const opsTransactionCategoriesTable = pgTable("ops_transaction_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // income | expense | reserve | refund
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opsTransactionsTable = pgTable("ops_transactions", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  type: text("type").notNull(), // income | expense | refund_in | refund_out | reserve_transfer
  amountKes: numeric("amount_kes", { precision: 15, scale: 2 }).notNull(),
  description: text("description").notNull(),
  cleared: boolean("cleared").notNull().default(false),
  categoryId: integer("category_id").references(() => opsTransactionCategoriesTable.id),
  weekId: integer("week_id").references(() => opsOperatingWeeksTable.id),
  paymentMethod: text("payment_method"),
  reference: text("reference"),
  notes: text("notes"),
  linkedFieldTripId: integer("linked_field_trip_id"),
  linkedContentId: integer("linked_content_id"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const opsRecurringExpensesTable = pgTable("ops_recurring_expenses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amountKes: numeric("amount_kes", { precision: 15, scale: 2 }),
  currencyType: text("currency_type").notNull().default("KES"),
  amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }),
  frequency: text("frequency").notNull(),
  categoryId: integer("category_id").references(() => opsTransactionCategoriesTable.id),
  nextBillingDate: date("next_billing_date", { mode: "string" }),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── TASKS ────────────────────────────────────────────────────────────────────

export const opsTasksTable = pgTable("ops_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  module: text("module").notNull().default("other"),
  type: text("type"),
  dueDate: date("due_date", { mode: "string" }),
  weekId: integer("week_id").references(() => opsOperatingWeeksTable.id),
  estimatedHours: numeric("estimated_hours", { precision: 6, scale: 2 }),
  actualHours: numeric("actual_hours", { precision: 6, scale: 2 }),
  assignedTo: text("assigned_to"),
  acceptanceCriteria: text("acceptance_criteria"),
  position: integer("position").notNull().default(0),
  isRecurring: boolean("is_recurring").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

// ─── CONTENT ──────────────────────────────────────────────────────────────────

export const opsContentItemsTable = pgTable("ops_content_items", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("idea"),
  weekId: integer("week_id").references(() => opsOperatingWeeksTable.id),
  isCore: boolean("is_core").notNull().default(false),
  platforms: text("platforms").array(),
  pillar: text("pillar"),
  format: text("format"),
  angle: text("angle"),
  hook: text("hook"),
  captionSeed: text("caption_seed"),
  cta: text("cta"),
  scheduledDate: date("scheduled_date", { mode: "string" }),
  postedDate: date("posted_date", { mode: "string" }),
  linkedFieldTripId: integer("linked_field_trip_id"),
  views: integer("views"),
  clicks: integer("clicks"),
  installs: integer("installs"),
  paidSubscribersAttributed: integer("paid_subscribers_attributed"),
  founderMinutes: integer("founder_minutes"),
  notes: text("notes"),
  complianceNotes: text("compliance_notes"),
  hasComplianceWarning: boolean("has_compliance_warning").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

// ─── FIELD ────────────────────────────────────────────────────────────────────

export const opsFieldTripsTable = pgTable("ops_field_trips", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  purpose: text("purpose").notNull(),
  corridor: text("corridor"),
  status: text("status").notNull().default("planned"),
  weekId: integer("week_id").references(() => opsOperatingWeeksTable.id),
  plannedKm: numeric("planned_km", { precision: 8, scale: 2 }),
  startOdometer: numeric("start_odometer", { precision: 10, scale: 1 }),
  endOdometer: numeric("end_odometer", { precision: 10, scale: 1 }),
  actualKm: numeric("actual_km", { precision: 8, scale: 2 }),
  parkingKes: numeric("parking_kes", { precision: 10, scale: 2 }),
  tollsKes: numeric("tolls_kes", { precision: 10, scale: 2 }),
  contingencyKes: numeric("contingency_kes", { precision: 10, scale: 2 }),
  actualFuelSpendKes: numeric("actual_fuel_spend_kes", { precision: 10, scale: 2 }),
  requiredOutputs: text("required_outputs"),
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opsRoadRecordsTable = pgTable("ops_road_records", {
  id: serial("id").primaryKey(),
  recordDate: date("record_date", { mode: "string" }),
  county: text("county").notNull(),
  corridor: text("corridor").notNull(),
  landmark: text("landmark"),
  direction: text("direction"),
  dataType: text("data_type").notNull(),
  coordinates: text("coordinates"),
  speedLimitKph: integer("speed_limit_kph"),
  confidence: text("confidence").notNull().default("D"),
  sourceType: text("source_type"),
  evidence: text("evidence"),
  verifier: text("verifier"),
  lastVerifiedDate: date("last_verified_date", { mode: "string" }),
  nextAction: text("next_action"),
  status: text("status").notNull().default("needs_verification"),
  linkedFieldTripId: integer("linked_field_trip_id").references(() => opsFieldTripsTable.id),
  notes: text("notes"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── SUBSCRIPTIONS ────────────────────────────────────────────────────────────

export const opsSubscriptionWeekMetricsTable = pgTable("ops_subscription_week_metrics", {
  id: serial("id").primaryKey(),
  weekId: integer("week_id").notNull().references(() => opsOperatingWeeksTable.id),
  periodStartDate: date("period_start_date", { mode: "string" }),
  newDownloads: integer("new_downloads"),
  trialsStarted: integer("trials_started"),
  newPaid: integer("new_paid"),
  renewals: integer("renewals"),
  cancellations: integer("cancellations"),
  activePaidEnd: integer("active_paid_end").notNull(),
  grossSalesKes: numeric("gross_sales_kes", { precision: 15, scale: 2 }),
  processorFeesKes: numeric("processor_fees_kes", { precision: 15, scale: 2 }),
  refundsKes: numeric("refunds_kes", { precision: 15, scale: 2 }),
  cashReceivedKes: numeric("cash_received_kes", { precision: 15, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── IMPORT BATCHES ───────────────────────────────────────────────────────────

export const opsImportBatchesTable = pgTable("ops_import_batches", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  filename: text("filename").notNull(),
  filePath: text("file_path"),
  fileChecksum: text("file_checksum"),
  sheetCount: integer("sheet_count"),
  rowsCreated: integer("rows_created"),
  rowsUpdated: integer("rows_updated"),
  rowsSkipped: integer("rows_skipped"),
  rowsErrored: integer("rows_errored"),
  warningsJson: text("warnings_json"),
  errorsJson: text("errors_json"),
  sheetsJson: text("sheets_json"),
  committedAt: timestamp("committed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

export const opsSettingsTable = pgTable("ops_settings", {
  id: serial("id").primaryKey(),
  firstFundingDate: date("first_funding_date", { mode: "string" }).notNull().default("2026-08-14"),
  weeklyFundingAmountKes: numeric("weekly_funding_amount_kes", { precision: 15, scale: 2 }).notNull().default("10000.00"),
  exchangeRateKesPerUsd: numeric("exchange_rate_kes_per_usd", { precision: 10, scale: 4 }).notNull().default("129.3600"),
  fuelPricePerLitreKes: numeric("fuel_price_per_litre_kes", { precision: 10, scale: 2 }).notNull().default("214.00"),
  vehicleEfficiencyKmPerLitre: numeric("vehicle_efficiency_km_per_litre", { precision: 8, scale: 2 }).notNull().default("12.00"),
  cashFloorKes: numeric("cash_floor_kes", { precision: 15, scale: 2 }).notNull().default("2500.00"),
  reserveTransferTargetKes: numeric("reserve_transfer_target_kes", { precision: 15, scale: 2 }).notNull().default("1500.00"),
  monthlySubscriptionPriceKes: numeric("monthly_subscription_price_kes", { precision: 10, scale: 2 }).notNull().default("0.00"),
  replitMonthlyUsd: numeric("replit_monthly_usd", { precision: 10, scale: 2 }).notNull().default("20.00"),
  replitNextBillingDate: date("replit_next_billing_date", { mode: "string" }),
  baselineActivePaid: integer("baseline_active_paid").notNull().default(0),
  baselineDownloads: integer("baseline_downloads").notNull().default(0),
  currentMrrOverrideKes: numeric("current_mrr_override_kes", { precision: 15, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────

export const opsConversationTypeEnum = pgEnum("ops_conversation_type", [
  "all_team",
  "department",
  "direct",
]);

export const opsConversationsTable = pgTable("ops_conversations", {
  id: serial("id").primaryKey(),
  type: opsConversationTypeEnum("type").notNull(),
  departmentId: integer("department_id").references(() => opsDepartmentsTable.id, { onDelete: "cascade" }),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opsMessagesTable = pgTable("ops_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => opsConversationsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(), // admin_users.id
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const opsConversationMembersTable = pgTable("ops_conversation_members", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => opsConversationsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(), // admin_users.id
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastReadMessageId: integer("last_read_message_id").references(() => opsMessagesTable.id, { onDelete: "set null" }),
});

// ─── TYPE EXPORTS ─────────────────────────────────────────────────────────────

export type OpsDepartment = typeof opsDepartmentsTable.$inferSelect;
export type OpsTeamMember = typeof opsTeamMembersTable.$inferSelect;
export type OpsInvitation = typeof opsInvitationsTable.$inferSelect;
export type OpsOperatingWeek = typeof opsOperatingWeeksTable.$inferSelect;
export type OpsWeeklyPlan = typeof opsWeeklyPlansTable.$inferSelect;
export type OpsWeeklyReview = typeof opsWeeklyReviewsTable.$inferSelect;
export type OpsTransactionCategory = typeof opsTransactionCategoriesTable.$inferSelect;
export type OpsTransaction = typeof opsTransactionsTable.$inferSelect;
export type OpsRecurringExpense = typeof opsRecurringExpensesTable.$inferSelect;
export type OpsTask = typeof opsTasksTable.$inferSelect;
export type OpsContentItem = typeof opsContentItemsTable.$inferSelect;
export type OpsFieldTrip = typeof opsFieldTripsTable.$inferSelect;
export type OpsRoadRecord = typeof opsRoadRecordsTable.$inferSelect;
export type OpsSubscriptionWeekMetric = typeof opsSubscriptionWeekMetricsTable.$inferSelect;
export type OpsImportBatch = typeof opsImportBatchesTable.$inferSelect;
export type OpsSettings = typeof opsSettingsTable.$inferSelect;
export type OpsConversation = typeof opsConversationsTable.$inferSelect;
export type OpsMessage = typeof opsMessagesTable.$inferSelect;
export type OpsConversationMember = typeof opsConversationMembersTable.$inferSelect;
