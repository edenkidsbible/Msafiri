/**
 * seedCourse.ts
 *
 * Reads the structured JSON files produced by scripts/extract_course.py and
 * upserts them into the course_chapters and course_lessons tables.
 *
 * Prerequisites:
 *   - DATABASE_URL environment variable must be set.
 *   - The course_chapters and course_lessons tables must already exist
 *     (created by Task 17: Driving course API & DB schema).
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run seed:course
 *   (or)
 *   DATABASE_URL=... npx tsx src/scripts/seedCourse.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types — mirror the JSON shape produced by extract_course.py
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: "paragraph" | "list" | "callout";
  text?: string;
  items?: string[];
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface LessonData {
  id: string;
  slug: string;
  chapterId: string;
  title: string;
  order: number;
  estimatedMinutes: number;
  content: ContentBlock[];
  keyPoints: string[];
  quiz: QuizQuestion[];
}

interface ChapterFile {
  id: string;
  slug: string;
  title: string;
  unitNumber: number;
  order: number;
  lessons: LessonData[];
}

interface IndexEntry {
  id: string;
  slug: string;
  title: string;
  unitNumber: number;
  order: number;
  filename: string;
}

interface CourseIndex {
  version: string;
  source: string;
  generatedAt: string;
  totalChapters: number;
  totalLessons: number;
  chapters: IndexEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(
  __dirname,
  "../../../../lib/db/src/data/course",
);

function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const indexPath = path.join(DATA_DIR, "index.json");
  if (!fs.existsSync(indexPath)) {
    console.error(
      `index.json not found at ${indexPath}.\n` +
      "Run scripts/extract_course.py first to generate the course JSON files.",
    );
    process.exit(1);
  }

  const index = readJson<CourseIndex>(indexPath);
  console.log(
    `Course: "${index.source}" v${index.version} — ` +
    `${index.totalChapters} chapters, ${index.totalLessons} lessons`,
  );

  const { Pool } = pg;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  let chaptersUpserted = 0;
  let lessonsUpserted = 0;

  for (const chapterEntry of index.chapters) {
    const chapterFile = path.join(DATA_DIR, chapterEntry.filename);
    if (!fs.existsSync(chapterFile)) {
      console.warn(`  ⚠ Missing file: ${chapterEntry.filename} — skipping`);
      continue;
    }

    const chapter = readJson<ChapterFile>(chapterFile);

    // Upsert chapter
    await pool.query(
      `INSERT INTO course_chapters (id, slug, title, unit_number, "order", created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         slug         = EXCLUDED.slug,
         title        = EXCLUDED.title,
         unit_number  = EXCLUDED.unit_number,
         "order"      = EXCLUDED."order",
         updated_at   = NOW()`,
      [chapter.id, chapter.slug, chapter.title, chapter.unitNumber, chapter.order],
    );
    chaptersUpserted++;

    // Upsert lessons
    for (const lesson of chapter.lessons) {
      await pool.query(
        `INSERT INTO course_lessons
           (id, slug, chapter_id, title, "order", estimated_minutes, content, key_points, quiz, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           slug              = EXCLUDED.slug,
           chapter_id        = EXCLUDED.chapter_id,
           title             = EXCLUDED.title,
           "order"           = EXCLUDED."order",
           estimated_minutes = EXCLUDED.estimated_minutes,
           content           = EXCLUDED.content,
           key_points        = EXCLUDED.key_points,
           quiz              = EXCLUDED.quiz,
           updated_at        = NOW()`,
        [
          lesson.id,
          lesson.slug,
          lesson.chapterId,
          lesson.title,
          lesson.order,
          lesson.estimatedMinutes,
          JSON.stringify(lesson.content),
          JSON.stringify(lesson.keyPoints),
          JSON.stringify(lesson.quiz),
        ],
      );
      lessonsUpserted++;
    }

    console.log(
      `  ✓ Chapter "${chapter.title}" — ${chapter.lessons.length} lesson(s)`,
    );
  }

  await pool.end();

  console.log(
    `\nSeed complete: ${chaptersUpserted} chapters, ${lessonsUpserted} lessons upserted.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("seedCourse failed:", err);
  process.exit(1);
});
