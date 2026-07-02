import { Router, type Request, type Response } from "express";
import { db, blogPostsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

const router = Router();

/** Replace {{YEAR}} with the current calendar year so articles stay evergreen. */
function injectYear<T extends Record<string, unknown>>(obj: T): T {
  const year = new Date().getFullYear().toString();
  const replace = (v: unknown): unknown =>
    typeof v === "string" ? v.replaceAll("{{YEAR}}", year) : v;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, replace(v)])) as T;
}

// GET /blog/posts
router.get("/blog/posts", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(20, Number(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const posts = await db
      .select({
        id: blogPostsTable.id,
        slug: blogPostsTable.slug,
        title: blogPostsTable.title,
        excerpt: blogPostsTable.excerpt,
        author: blogPostsTable.author,
        featuredImage: blogPostsTable.featuredImage,
        keywords: blogPostsTable.keywords,
        readCount: blogPostsTable.readCount,
        publishedAt: blogPostsTable.publishedAt,
        createdAt: blogPostsTable.createdAt,
      })
      .from(blogPostsTable)
      .where(eq(blogPostsTable.status, "published"))
      .orderBy(desc(blogPostsTable.publishedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(blogPostsTable)
      .where(eq(blogPostsTable.status, "published"));

    return res.json({
      posts: posts.map((p) => injectYear({ ...p, publishedAt: p.publishedAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString() })),
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit),
    });
  } catch (err) {
    console.error("GET /blog/posts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /blog/posts/:slug — increments read count
router.get("/blog/posts/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params as { slug: string };

    const [post] = await db
      .select()
      .from(blogPostsTable)
      .where(and(eq(blogPostsTable.slug, slug), eq(blogPostsTable.status, "published")));

    if (!post) return res.status(404).json({ error: "Post not found" });

    db.update(blogPostsTable)
      .set({ readCount: sql`${blogPostsTable.readCount} + 1` })
      .where(eq(blogPostsTable.id, post.id))
      .execute()
      .catch(() => {});

    return res.json(injectYear({
      ...post,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    }));
  } catch (err) {
    console.error("GET /blog/posts/:slug error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
