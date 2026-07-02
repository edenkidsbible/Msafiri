import { Router, type Request, type Response } from "express";
import { db, adminNotificationsTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";

const router = Router();

// GET /admin/notifications
router.get("/notifications", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(adminNotificationsTable)
      .orderBy(desc(adminNotificationsTable.createdAt))
      .limit(50);

    const unreadCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminNotificationsTable)
      .where(eq(adminNotificationsTable.isRead, false));

    return res.json({
      notifications: rows.map((n) => ({
        id:        n.id,
        title:     n.title,
        message:   n.message,
        type:      n.type,
        isRead:    n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: unreadCount[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("GET /admin/notifications error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/notifications/:id/read
router.patch("/notifications/:id/read", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    await db
      .update(adminNotificationsTable)
      .set({ isRead: true })
      .where(eq(adminNotificationsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /admin/notifications/:id/read error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /admin/notifications/read-all
router.patch("/notifications/read-all", async (_req: Request, res: Response) => {
  try {
    await db
      .update(adminNotificationsTable)
      .set({ isRead: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("PATCH /admin/notifications/read-all error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /admin/notifications/:id
router.delete("/notifications/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    await db
      .delete(adminNotificationsTable)
      .where(eq(adminNotificationsTable.id, id));
    return res.json({ success: true });
  } catch (err) {
    console.error("DELETE /admin/notifications/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
