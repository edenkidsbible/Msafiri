import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { creatorApplicationsTable } from "./creators";

export const promoCodesTable = pgTable("promo_codes", {
  id:            uuid("id").primaryKey().defaultRandom(),
  platform:      text("platform").notNull(),
  code:          text("code").notNull().unique(),
  applicationId: uuid("application_id").references(() => creatorApplicationsTable.id),
  sentAt:        timestamp("sent_at"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});
