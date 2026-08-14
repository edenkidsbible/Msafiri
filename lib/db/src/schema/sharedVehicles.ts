import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * shared_vehicles — server-side vehicle registry for the sharing feature.
 * Created when an owner taps "Share" on a vehicle in the garage; holds just
 * enough info to let other users search by plate and confirm it's the right car.
 *
 * The actual vehicle data (fuel type, odometer, service records) lives locally
 * on each driver's device; this table is purely for discovery and membership.
 */
export const sharedVehiclesTable = pgTable("shared_vehicles", {
  id:            uuid("id").primaryKey().defaultRandom(),
  ownerDeviceId: text("owner_device_id").notNull(),
  /** Canonical plate, e.g. "KDA 123A". Null if owner has no plate set. */
  plateNumber:   text("plate_number"),
  /** Human-readable display name, e.g. "Toyota Fielder" */
  displayName:   text("display_name").notNull(),
  vehicleType:   text("vehicle_type").notNull().default("car"),
  /** 5-char unambiguous share code, displayed as "MSF-XXXXX" */
  shareCode:     text("share_code").notNull().unique(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});

/**
 * vehicle_members — tracks who has joined a shared vehicle.
 * The owner gets a row (role="owner") when they register; co-drivers
 * get rows (role="driver") when they join via code or approved request.
 */
export const vehicleMembersTable = pgTable("vehicle_members", {
  id:             uuid("id").primaryKey().defaultRandom(),
  vehicleId:      uuid("vehicle_id").notNull().references(() => sharedVehiclesTable.id, { onDelete: "cascade" }),
  memberDeviceId: text("member_device_id").notNull(),
  role:           text("role").notNull().default("driver"),   // "owner" | "driver"
  status:         text("status").notNull().default("active"), // "active" | "removed"
  memberName:     text("member_name"),
  /**
   * Why this membership ended:
   *   null          — still active
   *   "left"        — co-driver voluntarily left; may rejoin with the share code
   *   "owner_removed" — owner expelled them; blocked from auto-rejoin until owner re-invites
   */
  removalReason:  text("removal_reason"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  /** One row per (vehicle, device) — backs the onConflictDoNothing() in join flows. */
  uniqMember: uniqueIndex("vehicle_members_vehicle_device_uniq").on(t.vehicleId, t.memberDeviceId),
}));

/**
 * vehicle_join_requests — pending "request to join" submitted via plate search.
 * The owner receives a push notification and can approve or decline.
 * Joining via share code bypasses this table entirely (instant join).
 */
export const vehicleJoinRequestsTable = pgTable("vehicle_join_requests", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  vehicleId:           uuid("vehicle_id").notNull().references(() => sharedVehiclesTable.id, { onDelete: "cascade" }),
  requesterDeviceId:   text("requester_device_id").notNull(),
  requesterName:       text("requester_name"),
  status:              text("status").notNull().default("pending"), // "pending" | "approved" | "declined"
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  resolvedAt:          timestamp("resolved_at"),
});

/**
 * vehicle_claims — submitted when a user believes a registered plate belongs
 * to them but is already registered under another account.
 * Reviewed by Msafiri support; no automated action is taken.
 */
export const vehicleClaimsTable = pgTable("vehicle_claims", {
  id:               uuid("id").primaryKey().defaultRandom(),
  vehicleId:        uuid("vehicle_id").notNull().references(() => sharedVehiclesTable.id, { onDelete: "cascade" }),
  claimantDeviceId: text("claimant_device_id").notNull(),
  claimNote:        text("claim_note"),
  /** Admin investigation notes — logbook details, contact history, decision rationale. */
  adminNote:        text("admin_note"),
  status:           text("status").notNull().default("pending"), // "pending" | "reviewed" | "resolved"
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});

export type SharedVehicleRow      = typeof sharedVehiclesTable.$inferSelect;
export type VehicleMemberRow      = typeof vehicleMembersTable.$inferSelect;
export type VehicleJoinRequestRow = typeof vehicleJoinRequestsTable.$inferSelect;
export type VehicleClaimRow       = typeof vehicleClaimsTable.$inferSelect;
