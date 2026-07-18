/**
 * seedCourseIfEmpty — runs at API server startup.
 *
 * If course_chapters is empty (first deploy / fresh DB), reads the JSON
 * course files bundled in the monorepo and upserts all chapters, lessons,
 * and quiz questions. Safe to run repeatedly — all inserts are ON CONFLICT
 * DO UPDATE (idempotent).
 */

import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import {
  courseChaptersTable,
  courseLessonsTable,
  courseQuizQuestionsTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// JSON shape (mirrors lib/db/src/data/course/*.json)
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  text?: string;
  items?: string[];
  path?: string;
  caption?: string;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface LessonData {
  slug: string;
  title: string;
  order: number;
  estimatedMinutes?: number;
  content: ContentBlock[];
  keyPoints: string[];
  quiz: QuizQuestion[];
}

interface ChapterFile {
  slug: string;
  title: string;
  order: number;
  lessons: LessonData[];
}

interface IndexEntry {
  slug: string;
  title: string;
  order: number;
  filename: string;
}

interface CourseIndex {
  chapters: IndexEntry[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Path to the course JSON data directory.
 * The API server runs from artifacts/api-server/ so process.cwd() is that
 * directory; two levels up reaches the monorepo root.
 */
function dataDir(): string {
  return path.resolve(process.cwd(), "../../lib/db/src/data/course");
}

export async function seedCourseIfEmpty(): Promise<void> {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(courseChaptersTable);

    if (count > 0) {
      logger.info({ count }, "Course data already seeded — skipping");
      return;
    }

    logger.info("Course tables empty — seeding course content…");

    const dir = dataDir();
    const indexPath = path.join(dir, "index.json");

    if (!fs.existsSync(indexPath)) {
      logger.warn({ indexPath }, "Course index.json not found — skipping seed");
      return;
    }

    const index: CourseIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

    let chaptersUpserted = 0;
    let lessonsUpserted = 0;

    for (const entry of index.chapters) {
      const filePath = path.join(dir, entry.filename);
      if (!fs.existsSync(filePath)) {
        logger.warn({ file: entry.filename }, "Missing chapter file — skipping");
        continue;
      }

      const chapter: ChapterFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      // Upsert chapter
      const [{ chapterId }] = await db
        .insert(courseChaptersTable)
        .values({ slug: chapter.slug, title: chapter.title, order: chapter.order })
        .onConflictDoUpdate({
          target: courseChaptersTable.slug,
          set: { title: chapter.title, order: chapter.order },
        })
        .returning({ chapterId: courseChaptersTable.id });

      chaptersUpserted++;

      for (const lesson of chapter.lessons) {
        const [{ lessonId }] = await db
          .insert(courseLessonsTable)
          .values({
            slug: lesson.slug,
            chapterId,
            title: lesson.title,
            order: lesson.order,
            estimatedMinutes: lesson.estimatedMinutes ?? 5,
            content: lesson.content ?? [],
            keyPoints: lesson.keyPoints ?? [],
          })
          .onConflictDoUpdate({
            target: courseLessonsTable.slug,
            set: {
              chapterId,
              title: lesson.title,
              order: lesson.order,
              estimatedMinutes: lesson.estimatedMinutes ?? 5,
              content: lesson.content ?? [],
              keyPoints: lesson.keyPoints ?? [],
            },
          })
          .returning({ lessonId: courseLessonsTable.id });

        // Quiz questions: delete-and-reinsert (no stable slug/id in JSON)
        if (lesson.quiz?.length) {
          await db
            .delete(courseQuizQuestionsTable)
            .where(eq(courseQuizQuestionsTable.lessonId, lessonId));

          for (let i = 0; i < lesson.quiz.length; i++) {
            const q = lesson.quiz[i];
            await db.insert(courseQuizQuestionsTable).values({
              lessonId,
              question: q.question,
              options: q.options,
              correctIndex: q.correctIndex,
              order: i,
            });
          }
        }

        lessonsUpserted++;
      }
    }

    logger.info({ chaptersUpserted, lessonsUpserted }, "Course seed complete");
  } catch (err) {
    logger.warn({ err }, "seedCourseIfEmpty failed — app will continue without course data");
  }
}
