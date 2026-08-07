import { Router, type Request, type Response } from "express";
import {
  db,
  courseChaptersTable,
  courseLessonsTable,
  courseQuizQuestionsTable,
  userCourseProgressTable,
  userCourseBookmarksTable,
} from "@workspace/db";
import * as r2 from "../lib/r2Storage";
import { eq, asc, and, sql } from "drizzle-orm";

const router = Router();

// GET /course/chapters — full chapter + lesson index (no content body)
router.get("/course/chapters", async (_req: Request, res: Response) => {
  try {
    const chapters = await db
      .select()
      .from(courseChaptersTable)
      .orderBy(asc(courseChaptersTable.order));

    const lessons = await db
      .select({
        id: courseLessonsTable.id,
        slug: courseLessonsTable.slug,
        chapterId: courseLessonsTable.chapterId,
        title: courseLessonsTable.title,
        order: courseLessonsTable.order,
        estimatedMinutes: courseLessonsTable.estimatedMinutes,
        createdAt: courseLessonsTable.createdAt,
      })
      .from(courseLessonsTable)
      .orderBy(asc(courseLessonsTable.order));

    const chapterMap = chapters.map((ch) => ({
      ...ch,
      createdAt: ch.createdAt.toISOString(),
      lessons: lessons
        .filter((l) => l.chapterId === ch.id)
        .map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    }));

    return res.json({ chapters: chapterMap });
  } catch (err) {
    console.error("GET /course/chapters error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /course/lessons/:slug — full lesson with content blocks, keyPoints, quiz questions
router.get("/course/lessons/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };

    const [lesson] = await db
      .select()
      .from(courseLessonsTable)
      .where(eq(courseLessonsTable.slug, slug));

    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    const questions = await db
      .select()
      .from(courseQuizQuestionsTable)
      .where(eq(courseQuizQuestionsTable.lessonId, lesson.id))
      .orderBy(asc(courseQuizQuestionsTable.order));

    return res.json({
      ...lesson,
      createdAt: lesson.createdAt.toISOString(),
      quizQuestions: questions,
      // audioUrl is a relative path consumed as `${API_BASE}${audioUrl}` in the mobile app
      audioUrl: lesson.audioUrl ? `/course/audio/${lesson.slug}` : null,
    });
  } catch (err) {
    console.error("GET /course/lessons/:slug error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /course/audio/:slug — stream lesson audio from Object Storage (no auth; course content is public)
router.get("/course/audio/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };

    const [lesson] = await db
      .select({ audioUrl: courseLessonsTable.audioUrl })
      .from(courseLessonsTable)
      .where(eq(courseLessonsTable.slug, slug));

    if (!lesson?.audioUrl) {
      return res.status(404).json({ error: "No audio for this lesson" });
    }

    // audioUrl stored as object path e.g. "audio/lesson-slug.mp3" — same key in
    // R2 and legacy Replit storage. Serve from R2 first, fall back to Replit.
    const objectPath = lesson.audioUrl;

    if (r2.isR2Configured()) {
      const meta = await r2.headObject(objectPath);
      if (meta) {
        const totalSize = meta.size;
        const rangeHeader = req.headers.range;

        if (rangeHeader) {
          // Validate Range header — only "bytes=start-end" and "bytes=start-"
          // forms are supported. Return 416 for anything malformed or out-of-bounds.
          const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
          if (!rangeMatch) {
            res.setHeader("Content-Range", `bytes */${totalSize}`);
            return res.status(416).json({ error: "Range Not Satisfiable" });
          }
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalSize - 1;
          if (isNaN(start) || isNaN(end) || start > end || start >= totalSize || end >= totalSize) {
            res.setHeader("Content-Range", `bytes */${totalSize}`);
            return res.status(416).json({ error: "Range Not Satisfiable" });
          }

          // Forward the validated range to R2 and use its response metadata.
          const { body, contentLength, contentRange } =
            await r2.getObjectStream(objectPath, `bytes=${start}-${end}`);
          res.writeHead(206, {
            "Content-Range": contentRange ?? `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(contentLength || end - start + 1),
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=86400",
          });
          body.pipe(res);
          return;
        }

        // Full-file response.
        const { body, contentLength } = await r2.getObjectStream(objectPath);
        res.writeHead(200, {
          "Accept-Ranges": "bytes",
          "Content-Length": String(contentLength || totalSize),
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=86400",
        });
        body.pipe(res);
        return;
      }
    }

    return res.status(404).json({ error: "Audio file not found" });
  } catch (err) {
    console.error("GET /course/audio/:slug error:", err);
    return res.status(404).json({ error: "Audio file not found" });
  }
});

// GET /course/search?q= — search lesson titles and content, returns up to 20 results with excerpt
router.get("/course/search", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ results: [] });

    const term = `%${q}%`;

    const matches = await db
      .select({
        slug: courseLessonsTable.slug,
        title: courseLessonsTable.title,
        estimatedMinutes: courseLessonsTable.estimatedMinutes,
        contentText: sql<string>`${courseLessonsTable.content}::text`,
      })
      .from(courseLessonsTable)
      .where(
        sql`${courseLessonsTable.title} ilike ${term} or ${courseLessonsTable.content}::text ilike ${term}`
      )
      .limit(20);

    const results = matches.map(({ slug, title, estimatedMinutes, contentText }) => {
      let excerpt = "";
      const idx = contentText.toLowerCase().indexOf(q.toLowerCase());
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(contentText.length, idx + q.length + 60);
        excerpt = (start > 0 ? "…" : "") + contentText.slice(start, end).replace(/["\[\]{}]/g, " ").trim() + (end < contentText.length ? "…" : "");
      }
      return { slug, title, estimatedMinutes, excerpt };
    });

    return res.json({ results });
  } catch (err) {
    console.error("GET /course/search error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /course/progress — upsert completion record
router.post("/course/progress", async (req: Request, res: Response) => {
  try {
    const { deviceId, lessonSlug, quizScore } = req.body as {
      deviceId?: string;
      lessonSlug?: string;
      quizScore?: number;
    };

    if (!deviceId || !lessonSlug) {
      return res.status(400).json({ error: "deviceId and lessonSlug are required" });
    }

    const [lesson] = await db
      .select({ id: courseLessonsTable.id })
      .from(courseLessonsTable)
      .where(eq(courseLessonsTable.slug, lessonSlug));

    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    await db
      .insert(userCourseProgressTable)
      .values({
        deviceId,
        lessonId: lesson.id,
        quizScore: quizScore ?? null,
        completedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userCourseProgressTable.deviceId, userCourseProgressTable.lessonId],
        set: {
          completedAt: new Date(),
          quizScore: quizScore ?? null,
        },
      });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /course/progress error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /course/progress?deviceId= — returns completed lessonSlugs and scores
router.get("/course/progress", async (req: Request, res: Response) => {
  try {
    const deviceId = String(req.query.deviceId ?? "").trim();
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const rows = await db
      .select({
        lessonSlug: courseLessonsTable.slug,
        completedAt: userCourseProgressTable.completedAt,
        quizScore: userCourseProgressTable.quizScore,
      })
      .from(userCourseProgressTable)
      .innerJoin(courseLessonsTable, eq(userCourseProgressTable.lessonId, courseLessonsTable.id))
      .where(eq(userCourseProgressTable.deviceId, deviceId));

    return res.json({
      progress: rows.map((r) => ({
        lessonSlug: r.lessonSlug,
        completedAt: r.completedAt.toISOString(),
        quizScore: r.quizScore,
      })),
    });
  } catch (err) {
    console.error("GET /course/progress error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /course/bookmarks — create a bookmark
router.post("/course/bookmarks", async (req: Request, res: Response) => {
  try {
    const { deviceId, lessonSlug } = req.body as {
      deviceId?: string;
      lessonSlug?: string;
    };

    if (!deviceId || !lessonSlug) {
      return res.status(400).json({ error: "deviceId and lessonSlug are required" });
    }

    const [lesson] = await db
      .select({ id: courseLessonsTable.id })
      .from(courseLessonsTable)
      .where(eq(courseLessonsTable.slug, lessonSlug));

    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    await db
      .insert(userCourseBookmarksTable)
      .values({ deviceId, lessonId: lesson.id })
      .onConflictDoNothing();

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /course/bookmarks error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /course/bookmarks — remove a bookmark
router.delete("/course/bookmarks", async (req: Request, res: Response) => {
  try {
    const { deviceId, lessonSlug } = req.body as {
      deviceId?: string;
      lessonSlug?: string;
    };

    if (!deviceId || !lessonSlug) {
      return res.status(400).json({ error: "deviceId and lessonSlug are required" });
    }

    const [lesson] = await db
      .select({ id: courseLessonsTable.id })
      .from(courseLessonsTable)
      .where(eq(courseLessonsTable.slug, lessonSlug));

    if (!lesson) return res.status(404).json({ error: "Lesson not found" });

    await db
      .delete(userCourseBookmarksTable)
      .where(
        and(
          eq(userCourseBookmarksTable.deviceId, deviceId),
          eq(userCourseBookmarksTable.lessonId, lesson.id)
        )
      );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /course/bookmarks error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /course/bookmarks?deviceId= — returns bookmarked lessonSlugs
router.get("/course/bookmarks", async (req: Request, res: Response) => {
  try {
    const deviceId = String(req.query.deviceId ?? "").trim();
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const rows = await db
      .select({
        lessonSlug: courseLessonsTable.slug,
        createdAt: userCourseBookmarksTable.createdAt,
      })
      .from(userCourseBookmarksTable)
      .innerJoin(courseLessonsTable, eq(userCourseBookmarksTable.lessonId, courseLessonsTable.id))
      .where(eq(userCourseBookmarksTable.deviceId, deviceId));

    return res.json({
      bookmarks: rows.map((r) => ({
        lessonSlug: r.lessonSlug,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /course/bookmarks error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
