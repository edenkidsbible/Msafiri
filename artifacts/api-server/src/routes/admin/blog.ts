import { Router, type Request, type Response } from "express";
import { db, blogPostsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { logAudit } from "../../lib/audit.js";
import blogSeedData from "../../data/blog-seed.json" with { type: "json" };

const router = Router();

function slugify(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatPost(p: typeof blogPostsTable.$inferSelect) {
  return {
    ...p,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /admin/blog/posts
router.get("/posts", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status as string | undefined;

    const whereClause =
      statusFilter && ["draft", "published"].includes(statusFilter)
        ? eq(blogPostsTable.status, statusFilter)
        : undefined;

    const posts = await db
      .select()
      .from(blogPostsTable)
      .where(whereClause)
      .orderBy(desc(blogPostsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(blogPostsTable)
      .where(whereClause);

    return res.json({ posts: posts.map(formatPost), total: count, page, limit, pages: Math.ceil(count / limit) });
  } catch (err) {
    console.error("GET /admin/blog/posts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/blog/posts/:id
router.get("/posts/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const [post] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.id, id));
    if (!post) return res.status(404).json({ error: "Post not found" });
    return res.json(formatPost(post));
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/blog/posts
router.post("/posts", async (req: Request, res: Response) => {
  try {
    const user = (req as any).adminUser;
    const { title, slug, excerpt, content, author, status, featuredImage, metaTitle, metaDescription, keywords } = req.body;

    if (!title) return res.status(400).json({ error: "title is required" });

    const finalSlug = slug ? slugify(slug) : slugify(title);

    const [post] = await db
      .insert(blogPostsTable)
      .values({
        title,
        slug: finalSlug,
        excerpt: excerpt || null,
        content: content || "",
        author: author || "Msafiri Team",
        status: status || "draft",
        featuredImage: featuredImage || null,
        metaTitle: metaTitle || null,
        metaDescription: metaDescription || null,
        keywords: Array.isArray(keywords) ? keywords : [],
        publishedAt: status === "published" ? new Date() : null,
      })
      .returning();

    await logAudit({
      actor: { id: user?.id ?? "system", name: user?.name ?? "Admin", role: user?.role ?? "admin" },
      action: "blog_post.create",
      targetType: "blog_post",
      targetId: post.id,
      details: { title: post.title },
    });
    return res.status(201).json(formatPost(post));
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "Slug already exists. Use a different title or slug." });
    console.error("POST /admin/blog/posts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /admin/blog/posts/:id
router.put("/posts/:id", async (req: Request, res: Response) => {
  try {
    const user = (req as any).adminUser;
    const { id } = req.params as { id: string };
    const { title, slug, excerpt, content, author, status, featuredImage, metaTitle, metaDescription, keywords } = req.body;

    const [existing] = await db.select().from(blogPostsTable).where(eq(blogPostsTable.id, id));
    if (!existing) return res.status(404).json({ error: "Post not found" });

    const wasPublished = existing.status === "published";
    const nowPublished = status === "published";

    const [post] = await db
      .update(blogPostsTable)
      .set({
        ...(title !== undefined && { title }),
        ...(slug !== undefined && { slug: slugify(slug) }),
        ...(excerpt !== undefined && { excerpt: excerpt || null }),
        ...(content !== undefined && { content }),
        ...(author !== undefined && { author }),
        ...(status !== undefined && { status }),
        ...(featuredImage !== undefined && { featuredImage: featuredImage || null }),
        ...(metaTitle !== undefined && { metaTitle: metaTitle || null }),
        ...(metaDescription !== undefined && { metaDescription: metaDescription || null }),
        ...(keywords !== undefined && { keywords: Array.isArray(keywords) ? keywords : [] }),
        publishedAt: nowPublished && !wasPublished ? new Date() : existing.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(blogPostsTable.id, id))
      .returning();

    await logAudit({
      actor: { id: user?.id ?? "system", name: user?.name ?? "Admin", role: user?.role ?? "admin" },
      action: "blog_post.update",
      targetType: "blog_post",
      targetId: post.id,
      details: { title: post.title, status: post.status },
    });
    return res.json(formatPost(post));
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "Slug already exists." });
    console.error("PUT /admin/blog/posts/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/blog/posts/:id
router.delete("/posts/:id", async (req: Request, res: Response) => {
  try {
    const user = (req as any).adminUser;
    const { id } = req.params as { id: string };
    const [post] = await db.delete(blogPostsTable).where(eq(blogPostsTable.id, id)).returning();
    if (!post) return res.status(404).json({ error: "Post not found" });
    await logAudit({
      actor: { id: user?.id ?? "system", name: user?.name ?? "Admin", role: user?.role ?? "admin" },
      action: "blog_post.delete",
      targetType: "blog_post",
      targetId: post.id,
      details: { title: post.title },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/blog/stats
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const topPosts = await db
      .select({
        id: blogPostsTable.id,
        slug: blogPostsTable.slug,
        title: blogPostsTable.title,
        status: blogPostsTable.status,
        readCount: blogPostsTable.readCount,
        publishedAt: blogPostsTable.publishedAt,
      })
      .from(blogPostsTable)
      .orderBy(desc(blogPostsTable.readCount))
      .limit(10);

    const [{ totalReads }] = await db
      .select({ totalReads: sql<number>`coalesce(sum(read_count), 0)::int` })
      .from(blogPostsTable);

    const [{ publishedCount }] = await db
      .select({ publishedCount: sql<number>`count(*)::int` })
      .from(blogPostsTable)
      .where(eq(blogPostsTable.status, "published"));

    const [{ draftCount }] = await db
      .select({ draftCount: sql<number>`count(*)::int` })
      .from(blogPostsTable)
      .where(eq(blogPostsTable.status, "draft"));

    return res.json({
      totalReads: totalReads ?? 0,
      publishedCount: publishedCount ?? 0,
      draftCount: draftCount ?? 0,
      topPosts: topPosts.map((p) => ({ ...p, publishedAt: p.publishedAt?.toISOString() ?? null })),
    });
  } catch (err) {
    console.error("GET /admin/blog/stats error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/blog/seed
// One-shot endpoint: inserts all posts from blog-seed.json that don't already
// exist (by slug). Safe to call multiple times — ON CONFLICT DO NOTHING.
router.post("/seed", async (req: Request, res: Response) => {
  try {
    const seedPosts: any[] = blogSeedData as any[];
    let inserted = 0;
    let skipped = 0;

    for (const p of seedPosts) {
      const result = await db
        .insert(blogPostsTable)
        .values({
          id:              p.id,
          slug:            p.slug,
          title:           p.title,
          excerpt:         p.excerpt ?? null,
          content:         p.content ?? "",
          author:          p.author ?? "Msafiri Team",
          status:          p.status ?? "published",
          featuredImage:   p.featured_image ?? null,
          metaTitle:       p.meta_title ?? null,
          metaDescription: p.meta_description ?? null,
          keywords:        Array.isArray(p.keywords)
                             ? p.keywords
                             : (p.keywords
                                  ? JSON.parse(p.keywords.replace(/^\{/, "[").replace(/\}$/, "]"))
                                  : []),
          readCount:       p.read_count ?? 0,
          publishedAt:     p.published_at ? new Date(p.published_at) : null,
          createdAt:       p.created_at ? new Date(p.created_at) : new Date(),
          updatedAt:       p.updated_at ? new Date(p.updated_at) : new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: blogPostsTable.id });

      if (result.length > 0) inserted++;
      else skipped++;
    }

    const actor = (req as any).adminUser;
    await logAudit({
      actor: { id: actor.id, name: actor.name, role: actor.role },
      action: "blog_posts.seeded",
      targetType: "blog_posts",
      targetId: "seed",
      details: { inserted, skipped, total: seedPosts.length },
    });

    return res.json({ success: true, inserted, skipped, total: seedPosts.length });
  } catch (err) {
    console.error("POST /admin/blog/seed error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
