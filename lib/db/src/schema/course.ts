import { pgTable, uuid, text, integer, timestamp, jsonb, unique } from "drizzle-orm/pg-core";

export const courseChaptersTable = pgTable("course_chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  order: integer("order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CourseChapter = typeof courseChaptersTable.$inferSelect;
export type NewCourseChapter = typeof courseChaptersTable.$inferInsert;

export const courseLessonsTable = pgTable("course_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  chapterId: uuid("chapter_id")
    .notNull()
    .references(() => courseChaptersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  order: integer("order").notNull(),
  estimatedMinutes: integer("estimated_minutes").notNull().default(5),
  content: jsonb("content").notNull().$type<Record<string, unknown>[]>().default([]),
  keyPoints: text("key_points").array().notNull().default([]),
  audioUrl: text("audio_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CourseLesson = typeof courseLessonsTable.$inferSelect;
export type NewCourseLesson = typeof courseLessonsTable.$inferInsert;

export const courseQuizQuestionsTable = pgTable("course_quiz_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => courseLessonsTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  options: text("options").array().notNull(),
  correctIndex: integer("correct_index").notNull(),
  order: integer("order").notNull(),
});

export type CourseQuizQuestion = typeof courseQuizQuestionsTable.$inferSelect;
export type NewCourseQuizQuestion = typeof courseQuizQuestionsTable.$inferInsert;

export const userCourseProgressTable = pgTable(
  "user_course_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => courseLessonsTable.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    quizScore: integer("quiz_score"),
  },
  (t) => [unique("uq_progress_device_lesson").on(t.deviceId, t.lessonId)]
);

export type UserCourseProgress = typeof userCourseProgressTable.$inferSelect;
export type NewUserCourseProgress = typeof userCourseProgressTable.$inferInsert;

export const userCourseBookmarksTable = pgTable(
  "user_course_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id").notNull(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => courseLessonsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_bookmark_device_lesson").on(t.deviceId, t.lessonId)]
);

export type UserCourseBookmark = typeof userCourseBookmarksTable.$inferSelect;
export type NewUserCourseBookmark = typeof userCourseBookmarksTable.$inferInsert;
