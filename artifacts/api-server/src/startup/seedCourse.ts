/**
 * seedCourseIfEmpty — runs at API server startup.
 *
 * If course_chapters is empty (first deploy / fresh DB), upserts all chapters,
 * lessons, and quiz questions from the data bundled at build time.
 *
 * The chapter JSON files are imported statically (see courseChapterFiles.ts)
 * so esbuild inlines them into dist/index.mjs.  Runtime fs.readFileSync is
 * intentionally NOT used — the source files don't exist on the production
 * server; only the compiled bundle does.
 */

import { db } from "@workspace/db";
import {
  courseChaptersTable,
  courseLessonsTable,
  courseQuizQuestionsTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { allChapterFiles } from "./courseChapterFiles";

export async function seedCourseIfEmpty(): Promise<void> {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(courseChaptersTable);

    if (count > 0) {
      logger.info({ count }, "Course data already seeded — skipping");
      return;
    }

    logger.info(
      { chapters: allChapterFiles.length },
      "Course tables empty — seeding course content…"
    );

    let chaptersUpserted = 0;
    let lessonsUpserted = 0;

    for (const chapter of allChapterFiles) {
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
    logger.error({ err }, "seedCourseIfEmpty failed");
  }
}
