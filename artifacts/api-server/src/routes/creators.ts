import { Router, type Request, type Response } from "express";
import { db, creatorApplicationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.post("/creator-application", async (req: Request, res: Response) => {
  try {
    const { deviceId, name, email, platform, reason } = req.body;

    if (!deviceId || !email) {
      return res.status(400).json({ error: "deviceId and email are required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    // Deduplicate by deviceId OR email so the same person can't slip in
    // from a second device, and so a shared/unknown deviceId can't block
    // unrelated users.
    const { or } = await import("drizzle-orm");
    const [existing] = await db
      .select({ id: creatorApplicationsTable.id, status: creatorApplicationsTable.status })
      .from(creatorApplicationsTable)
      .where(or(
        eq(creatorApplicationsTable.deviceId, deviceId),
        eq(creatorApplicationsTable.email, email.trim().toLowerCase()),
      ))
      .limit(1);

    if (existing) {
      return res.json({ success: true, alreadyApplied: true, status: existing.status });
    }

    const [application] = await db
      .insert(creatorApplicationsTable)
      .values({
        deviceId,
        name: name?.trim() || null,
        email: email.trim().toLowerCase(),
        platform: platform ?? null,
        reason: reason?.trim() || null,
      })
      .returning({ id: creatorApplicationsTable.id });

    return res.status(201).json({ success: true, id: application.id });
  } catch (err) {
    console.error("POST /creator-application error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
