import { pgTable, text, uuid, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const inboxEmailsTable = pgTable("inbox_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: text("message_id").unique(), // RFC Message-Id header — deduplication key
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull().default("(no subject)"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  isRead: boolean("is_read").notNull().default(false),
  isReplied: boolean("is_replied").notNull().default(false),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  replyCount: integer("reply_count").notNull().default(0),
  inReplyTo: text("in_reply_to"),  // In-Reply-To header for threading
  references: text("references"),   // References header for threading
  spamScore: text("spam_score"),
  rawHeaders: text("raw_headers"),  // JSON-stringified headers for debugging
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
