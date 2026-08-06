import { Router, type Request, type Response } from "express";
import { db, emergencyContactsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendSms } from "../lib/sms.js";

const router: Router = Router();

// ── Emergency Contacts CRUD ────────────────────────────────────────────────

// GET /emergency-contacts?deviceId=
router.get("/emergency-contacts", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const rows = await db
      .select()
      .from(emergencyContactsTable)
      .where(eq(emergencyContactsTable.deviceId, deviceId))
      .orderBy(emergencyContactsTable.createdAt);

    return res.json({
      contacts: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phoneE164,
        createdAt: r.createdAt.getTime(),
      })),
    });
  } catch (err) {
    console.error("GET /emergency-contacts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /emergency-contacts
router.post("/emergency-contacts", async (req: Request, res: Response) => {
  try {
    const { deviceId, name, phone } = req.body as { deviceId: string; name: string; phone: string };
    if (!deviceId || !name || !phone) {
      return res.status(400).json({ error: "deviceId, name, and phone are required" });
    }

    // Enforce max 5 contacts per device
    const existing = await db
      .select({ id: emergencyContactsTable.id })
      .from(emergencyContactsTable)
      .where(eq(emergencyContactsTable.deviceId, deviceId));

    if (existing.length >= 5) {
      return res.status(422).json({ error: "Maximum of 5 emergency contacts allowed" });
    }

    const [inserted] = await db
      .insert(emergencyContactsTable)
      .values({ deviceId, name, phoneE164: phone })
      .returning();

    return res.status(201).json({
      id: inserted.id,
      name: inserted.name,
      phone: inserted.phoneE164,
      createdAt: inserted.createdAt.getTime(),
    });
  } catch (err) {
    console.error("POST /emergency-contacts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /emergency-contacts/:id
router.patch("/emergency-contacts/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, name, phone } = req.body as { deviceId: string; name?: string; phone?: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const [row] = await db
      .select()
      .from(emergencyContactsTable)
      .where(and(eq(emergencyContactsTable.id, id), eq(emergencyContactsTable.deviceId, deviceId)));

    if (!row) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(emergencyContactsTable)
      .set({
        ...(name ? { name } : {}),
        ...(phone ? { phoneE164: phone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(emergencyContactsTable.id, id))
      .returning();

    return res.json({
      id: updated.id,
      name: updated.name,
      phone: updated.phoneE164,
      createdAt: updated.createdAt.getTime(),
    });
  } catch (err) {
    console.error("PATCH /emergency-contacts/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /emergency-contacts/:id
router.delete("/emergency-contacts/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    await db
      .delete(emergencyContactsTable)
      .where(and(eq(emergencyContactsTable.id, id), eq(emergencyContactsTable.deviceId, deviceId)));

    return res.status(204).send();
  } catch (err) {
    console.error("DELETE /emergency-contacts/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Emergency Alert ────────────────────────────────────────────────────────

// POST /emergency/alert
router.post("/emergency/alert", async (req: Request, res: Response) => {
  try {
    const { deviceId, lat, lng, driverName, isTest } = req.body as {
      deviceId: string;
      lat: number;
      lng: number;
      driverName?: string;
      isTest?: boolean;
    };

    if (!deviceId || lat == null || lng == null) {
      return res.status(400).json({ error: "deviceId, lat, lng are required" });
    }

    const contacts = await db
      .select()
      .from(emergencyContactsTable)
      .where(eq(emergencyContactsTable.deviceId, deviceId));

    if (contacts.length === 0) {
      return res.json({ sent: 0, message: "No emergency contacts saved" });
    }

    const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
    const now = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
    const name = driverName?.trim() || "A Msafiri user";
    const prefix = isTest ? "[TEST] " : "";

    const body = isTest
      ? `${prefix}This is a test alert from ${name} on Msafiri Kenya. No emergency has occurred. Their current location: ${mapsLink}`
      : `${prefix}EMERGENCY ALERT: ${name} may have been in a car accident. Last known location: ${mapsLink}\n\nTime: ${now} (Nairobi)\n\nSent automatically by Msafiri Kenya.`;

    let sent = 0;
    for (const contact of contacts) {
      try {
        const ok = await sendSms(contact.phoneE164, body);
        if (ok) sent++;
      } catch (smsErr) {
        console.error("SMS send error to", contact.phoneE164, smsErr);
      }
    }

    return res.json({ sent, total: contacts.length });
  } catch (err) {
    console.error("POST /emergency/alert error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
