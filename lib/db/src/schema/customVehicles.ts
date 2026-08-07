import { pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Captures user-submitted vehicle makes/models that don't appear in the
 * static CAR_MAKES list.  Records are deduplicated by (make_slug, model_slug)
 * so that a second user picking the same vehicle increments submitted_count
 * instead of creating a duplicate row.
 *
 * image_status lifecycle: "pending" → image generation queued but not yet
 * complete; "done" → R2 image ready at car-images/{makeSlug}/{modelSlug}.png
 */
export const customVehiclesTable = pgTable("custom_vehicles", {
  id:            uuid("id").primaryKey().defaultRandom(),
  /** User-facing display name for the make ("Haima", "Foton", …). */
  makeName:      text("make_name").notNull(),
  /** User-facing display name for the model ("S5", "M3", …). */
  modelName:     text("model_name").notNull(),
  /** URL-safe slug derived from makeName — used as the R2 key segment. */
  makeSlug:      text("make_slug").notNull(),
  /** URL-safe slug derived from modelName. */
  modelSlug:     text("model_slug").notNull(),
  /**
   * When the user picked a make from the known list but typed a custom model,
   * this holds the known make's id (e.g. "toyota").  null = fully custom make.
   */
  knownMakeId:   text("known_make_id"),
  /** "pending" while the image generation job is running; "done" when available. */
  imageStatus:   text("image_status").notNull().default("pending"),
  /** How many distinct users have submitted this same make+model pair. */
  submittedCount: integer("submitted_count").notNull().default(1),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
