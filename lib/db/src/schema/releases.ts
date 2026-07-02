import { pgTable, uuid, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const appReleasesTable = pgTable("app_releases", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  version:            text("version").notNull(),                      // "1.2.0"
  buildNumber:        integer("build_number").notNull().default(1),   // 12
  platform:           text("platform").notNull().default("all"),      // "all" | "ios" | "android"
  releaseType:        text("release_type").notNull().default("patch"), // "major" | "minor" | "patch" | "hotfix"
  releaseNotes:       text("release_notes"),
  status:             text("status").notNull().default("draft"),      // "draft" | "live" | "deprecated"
  isForceUpdate:      boolean("is_force_update").notNull().default(false),
  storeUrlIos:        text("store_url_ios"),
  storeUrlAndroid:    text("store_url_android"),
  createdBy:          text("created_by").notNull().default("system"),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  publishedAt:        timestamp("published_at"),
});

export type AppReleaseRow = typeof appReleasesTable.$inferSelect;
