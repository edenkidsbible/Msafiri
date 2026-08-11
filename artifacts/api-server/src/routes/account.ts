/**
 * Account / data-management routes.
 *
 * DELETE /api/account/data  — wipe all device-scoped data from every table.
 *   Body: { deviceId: string }
 *   Returns: { deleted: Record<string, number> }
 *
 * The device is authenticated purely by deviceId (same pattern as every other
 * endpoint in this app). We delete all rows that belong to the caller's device
 * and return a per-table count so the client can show a summary.
 */

import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  savedPlacesTable,
  plannedTripsTable,
  communityReportsTable,
  pushTokensTable,
  emergencyContactsTable,
  deviceBackupsTable,
  userCourseProgressTable,
  userCourseBookmarksTable,
  dashcamClipsTable,
  dashcamDevicesTable,
  brakingEventsTable,
  accidentRecordsTable,
  accidentPhotosTable,
  accidentWitnessesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

const router = Router();

// ── DELETE /account/data ──────────────────────────────────────────────────────
router.delete("/account/data", async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body as { deviceId?: string };
    if (!deviceId?.trim()) {
      return res.status(400).json({ error: "deviceId is required" });
    }
    const did = deviceId.trim();

    // Collect accident IDs first so we can cascade to photos/witnesses
    const accidents = await db
      .select({ id: accidentRecordsTable.id })
      .from(accidentRecordsTable)
      .where(eq(accidentRecordsTable.deviceId, did));
    const accidentIds = accidents.map((a) => a.id);

    // Delete accident sub-records first (FK dependents)
    let photosRes: unknown[] = [], witnessRes: unknown[] = [];
    if (accidentIds.length) {
      [photosRes, witnessRes] = await Promise.all([
        db.delete(accidentPhotosTable).where(inArray(accidentPhotosTable.accidentId, accidentIds)).returning(),
        db.delete(accidentWitnessesTable).where(inArray(accidentWitnessesTable.accidentId, accidentIds)).returning(),
      ]);
    }

    // Delete all remaining device-scoped data in parallel
    const [
      accidentRes, savedRes, tripsRes, reportsRes,
      pushRes, emergencyRes, backupsRes,
      courseProgressRes, courseBookRes,
      clipsRes, devicesRes, brakingRes,
    ] = await Promise.all([
      db.delete(accidentRecordsTable).where(eq(accidentRecordsTable.deviceId, did)).returning(),
      db.delete(savedPlacesTable).where(eq(savedPlacesTable.deviceId, did)).returning(),
      db.delete(plannedTripsTable).where(eq(plannedTripsTable.deviceId, did)).returning(),
      db.delete(communityReportsTable).where(eq(communityReportsTable.deviceId, did)).returning(),
      db.delete(pushTokensTable).where(eq(pushTokensTable.deviceId, did)).returning(),
      db.delete(emergencyContactsTable).where(eq(emergencyContactsTable.deviceId, did)).returning(),
      db.delete(deviceBackupsTable).where(eq(deviceBackupsTable.deviceId, did)).returning(),
      db.delete(userCourseProgressTable).where(eq(userCourseProgressTable.deviceId, did)).returning(),
      db.delete(userCourseBookmarksTable).where(eq(userCourseBookmarksTable.deviceId, did)).returning(),
      // Dashcam metadata (R2 files are NOT deleted — that requires a separate purge job)
      db.delete(dashcamClipsTable).where(eq(dashcamClipsTable.deviceId, did)).returning(),
      db.delete(dashcamDevicesTable).where(eq(dashcamDevicesTable.deviceId, did)).returning(),
      db.delete(brakingEventsTable).where(eq(brakingEventsTable.deviceId, did)).returning(),
    ]);

    const deleted = {
      accidents: accidentRes.length,
      accidentPhotos: photosRes.length,
      accidentWitnesses: witnessRes.length,
      savedPlaces: savedRes.length,
      plannedTrips: tripsRes.length,
      communityReports: reportsRes.length,
      pushTokens: pushRes.length,
      emergencyContacts: emergencyRes.length,
      deviceBackups: backupsRes.length,
      courseProgress: courseProgressRes.length,
      courseBookmarks: courseBookRes.length,
      dashcamClips: clipsRes.length,
      dashcamDevices: devicesRes.length,
      brakingEvents: brakingRes.length,
    };

    return res.json({ ok: true, deleted });
  } catch (err) {
    console.error("DELETE /account/data error:", err);
    return res.status(500).json({ error: "Failed to delete account data" });
  }
});

export default router;
