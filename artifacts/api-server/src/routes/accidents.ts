/**
 * Crash Assistant — Accident Records API
 *
 * All routes use deviceId for ownership (consistent with dashcam, community reports).
 * No JWT required — the stable device identifier is the authentication mechanism.
 *
 * Routes:
 *  POST   /accidents                              Create record (auto on crash or manual)
 *  GET    /accidents                              List records for a device
 *  GET    /accidents/:id                          Full record with photos/witnesses/timeline
 *  PATCH  /accidents/:id                          Update editable fields
 *  POST   /accidents/:id/photos/request-upload    Get presigned upload URL for a photo
 *  POST   /accidents/:id/photos/:photoId/confirm  Finalize photo after client PUT
 *  DELETE /accidents/:id/photos/:photoId          Delete a photo
 *  POST   /accidents/:id/witnesses                Add a witness
 *  DELETE /accidents/:id/witnesses/:witnessId     Remove a witness
 *  POST   /accidents/:id/timeline-event           Add a timeline event
 *  GET    /accidents/:id/report                   Generate (or return cached) PDF report
 *  GET    /accidents/:id/report/url               Fresh signed download URL for existing PDF
 */

import { Router, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import {
  db,
  accidentRecordsTable,
  accidentPhotosTable,
  accidentWitnessesTable,
  accidentTimelineEventsTable,
} from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import * as r2 from "../lib/r2Storage.js";

const router = Router();

/** Signed GET URL for a stored fileKey (R2 only — legacy GCS retired). */
async function signedDownloadUrl(fileKey: string, _ttlSec: number): Promise<string> {
  return r2.getPresignedDownloadUrl(fileKey);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function headingToDirection(deg: number | null): string | null {
  if (deg == null) return null;
  const dirs = [
    "Northbound", "Northeastbound", "Eastbound", "Southeastbound",
    "Southbound", "Southwestbound", "Westbound", "Northwestbound",
  ];
  return dirs[Math.round(deg / 45) % 8] ?? null;
}

function wmoCodeToDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Overcast";
}

function wmoCodeToRoadCondition(code: number): string {
  if (code === 0 || code <= 3) return "Dry roads";
  if (code <= 48) return "Low visibility";
  if (code <= 67 || code <= 82) return "Wet roads";
  if (code <= 77 || code <= 86) return "Possible ice";
  if (code >= 95) return "Wet roads, poor visibility";
  return "Variable conditions";
}

async function fetchWeather(lat: number, lng: number): Promise<object | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&forecast_days=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json() as { current_weather?: { temperature: number; windspeed: number; weathercode: number } };
    const cw = data.current_weather;
    if (!cw) return null;
    return {
      description:    wmoCodeToDescription(cw.weathercode),
      tempC:          Math.round(cw.temperature),
      windspeedKmh:   Math.round(cw.windspeed),
      roadCondition:  wmoCodeToRoadCondition(cw.weathercode),
      weatherCode:    cw.weathercode,
    };
  } catch {
    return null;
  }
}

async function getFullRecord(id: string, deviceId: string) {
  const [record] = await db
    .select().from(accidentRecordsTable)
    .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")));
  if (!record) return null;
  const [photos, witnesses, timeline] = await Promise.all([
    db.select().from(accidentPhotosTable).where(eq(accidentPhotosTable.accidentId, id)),
    db.select().from(accidentWitnessesTable).where(eq(accidentWitnessesTable.accidentId, id)).orderBy(accidentWitnessesTable.createdAt),
    db.select().from(accidentTimelineEventsTable).where(eq(accidentTimelineEventsTable.accidentId, id)).orderBy(accidentTimelineEventsTable.occurredAt),
  ]);
  return { record, photos, witnesses, timeline };
}

// ── PDF Generation ────────────────────────────────────────────────────────────

async function generatePdf(
  record: typeof accidentRecordsTable.$inferSelect,
  photos: (typeof accidentPhotosTable.$inferSelect)[],
  witnesses: (typeof accidentWitnessesTable.$inferSelect)[],
  timeline: (typeof accidentTimelineEventsTable.$inferSelect)[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 55, bottom: 55, left: 55, right: 55 } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const incidentId = `MSF-${record.createdAt.getFullYear()}-${record.id.slice(-6).toUpperCase()}`;
    const W = doc.page.width - 110;
    const primary = "#C0392B";
    const muted = "#666666";

    // ── Cover header ─────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(primary);
    doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold").text("Crash Assistant", 55, 22, { width: W });
    doc.fontSize(10).font("Helvetica").fillColor("rgba(255,255,255,0.8)").text("Msafiri Kenya — Accident Report", 55, 50);
    doc.fillColor("#000").moveDown(3);

    function sectionTitle(title: string) {
      doc.moveDown(0.5)
        .fontSize(11).font("Helvetica-Bold").fillColor(primary).text(title.toUpperCase())
        .moveDown(0.15)
        .moveTo(55, doc.y).lineTo(55 + W, doc.y).strokeColor(primary).lineWidth(1).stroke()
        .moveDown(0.4);
      doc.fillColor("#000").font("Helvetica").fontSize(10);
    }

    function row(label: string, value: string | null | undefined) {
      if (!value) return;
      doc.fontSize(10).font("Helvetica-Bold").fillColor(muted).text(label, { continued: true, width: 150 });
      doc.font("Helvetica").fillColor("#111").text(value);
    }

    // ── Incident Summary ─────────────────────────────────────────────────────
    sectionTitle("Incident Summary");
    row("Report ID",     incidentId);
    row("Date & Time",  record.detectedAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "long", timeStyle: "short" }));
    row("Report Type",  record.isManual ? "Manually created" : "Auto-detected (crash sensor)");
    row("Status",       record.status === "complete" ? "Complete" : "Draft (in progress)");

    // ── Location ─────────────────────────────────────────────────────────────
    sectionTitle("Location");
    row("Road",         record.roadName);
    row("Nearby",       record.nearbyLandmark);
    row("County",       record.county);
    row("Coordinates",  record.lat && record.lng ? `${Number(record.lat).toFixed(5)}, ${Number(record.lng).toFixed(5)}` : null);
    row("Maps Link",    record.lat && record.lng ? `https://maps.google.com/?q=${record.lat},${record.lng}` : null);

    // ── Speed & Motion ───────────────────────────────────────────────────────
    sectionTitle("Vehicle Data");
    row("Speed Before Impact", record.speedBeforeKmh ? `${Math.round(Number(record.speedBeforeKmh))} km/h` : null);
    row("Speed at Impact",     record.speedAtImpactKmh ? `${Math.round(Number(record.speedAtImpactKmh))} km/h` : null);
    row("Direction",           record.directionLabel);
    if (record.headingDeg) row("Heading", `${Math.round(Number(record.headingDeg))}°`);

    // ── Journey Info ─────────────────────────────────────────────────────────
    if (record.tripStartAt || record.distanceM) {
      sectionTitle("Journey");
      if (record.tripStartAt) row("Trip Started", record.tripStartAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", timeStyle: "short", dateStyle: "short" }));
      if (record.destinationName) row("Destination", record.destinationName);
      if (record.distanceM) row("Distance Travelled", `${(Number(record.distanceM) / 1000).toFixed(1)} km`);
      if (record.durationS) {
        const mins = Math.round(Number(record.durationS) / 60);
        row("Duration", `${mins} min`);
      }
    }

    // ── Weather ──────────────────────────────────────────────────────────────
    if (record.weatherJson) {
      try {
        const w = JSON.parse(record.weatherJson) as { description?: string; tempC?: number; windspeedKmh?: number; roadCondition?: string };
        sectionTitle("Weather at Time of Incident");
        if (w.description)    row("Conditions",     w.description);
        if (w.tempC != null)  row("Temperature",    `${w.tempC}°C`);
        if (w.windspeedKmh)   row("Wind Speed",     `${w.windspeedKmh} km/h`);
        if (w.roadCondition)  row("Road Condition", w.roadCondition);
      } catch { /* malformed JSON */ }
    }

    // ── Timeline ─────────────────────────────────────────────────────────────
    if (timeline.length > 0) {
      sectionTitle("Event Timeline");
      for (const evt of timeline) {
        const time = evt.occurredAt.toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", timeStyle: "short" });
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text(`${time}  `, { continued: true });
        doc.font("Helvetica").fillColor(muted).text(evt.description ?? evt.eventType);
      }
    }

    // ── Witnesses ────────────────────────────────────────────────────────────
    if (witnesses.length > 0) {
      sectionTitle("Witnesses");
      for (const w of witnesses) {
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#111").text(w.name);
        if (w.phone) doc.font("Helvetica").fillColor(muted).fontSize(9).text(`Phone: ${w.phone}`);
        if (w.notes) doc.font("Helvetica").fillColor(muted).fontSize(9).text(w.notes);
        doc.moveDown(0.3);
      }
    }

    // ── Other Party ──────────────────────────────────────────────────────────
    if (record.otherDriverJson) {
      try {
        const od = JSON.parse(record.otherDriverJson) as {
          type?: string;
          // vehicle
          vehicleType?: string; vehicleReg?: string; name?: string; phone?: string;
          insuranceCompany?: string; policyNumber?: string;
          // pedestrian/cyclist
          injuries?: string;
          // solo
          cause?: string;
          notes?: string;
        };
        const hasContent = od.name || od.vehicleReg || od.cause || od.injuries || od.type;
        if (hasContent) {
          const secLabel =
            od.type === "solo"               ? "Incident Cause (Solo — No Other Party)" :
            od.type === "pedestrian_cyclist" ? "Other Party — Pedestrian / Cyclist"     :
            /* vehicle or unset */             "Other Party — Vehicle";
          sectionTitle(secLabel);

          if (od.type === "solo") {
            row("Cause",  od.cause);
            row("Notes",  od.notes);
          } else if (od.type === "pedestrian_cyclist") {
            row("Name (if known)",       od.name);
            row("Phone (if known)",      od.phone);
            row("Injuries / Condition",  od.injuries);
            row("Notes",                 od.notes);
          } else {
            // vehicle collision (explicit or legacy)
            row("Vehicle Type",      od.vehicleType);
            row("Registration",      od.vehicleReg);
            row("Driver Name",       od.name);
            row("Phone",             od.phone);
            row("Insurance Company", od.insuranceCompany);
            row("Policy Number",     od.policyNumber);
          }
        }
      } catch { /* malformed JSON — skip */ }
    }

    // ── Police ───────────────────────────────────────────────────────────────
    if (record.policeJson) {
      try {
        const p = JSON.parse(record.policeJson) as {
          station?: string; officerName?: string; obNumber?: string; reference?: string;
        };
        if (p.station || p.obNumber) {
          sectionTitle("Police Information");
          row("Station",      p.station);
          row("Officer",      p.officerName);
          row("OB Number",    p.obNumber);
          row("Reference",    p.reference);
        }
      } catch { /* malformed */ }
    }

    // ── Driver Statement ─────────────────────────────────────────────────────
    if (record.driverStatement) {
      sectionTitle("Driver Statement");
      doc.fontSize(10).font("Helvetica").fillColor("#111").text(record.driverStatement, { width: W, lineGap: 4 });
    }

    // ── Audio Statement ───────────────────────────────────────────────────────
    const audioPhotos = photos.filter((p) => p.category === "audio_statement");
    if (audioPhotos.length > 0) {
      sectionTitle("Audio Statement");
      doc.fontSize(10).font("Helvetica").fillColor(muted)
        .text("An audio statement was recorded at the scene. Open Accident Reports in Msafiri Kenya to listen to the recording.");
    }

    // ── Scene Photos note ─────────────────────────────────────────────────────
    const scenePhotos = photos.filter((p) => p.category !== "audio_statement");
    if (scenePhotos.length > 0) {
      sectionTitle("Attached Scene Photos");
      doc.fontSize(10).font("Helvetica").fillColor(muted)
        .text(`${scenePhotos.length} photo(s) were captured at the scene. View the full accident record in Msafiri Kenya for embedded images.`);
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    doc.moveDown(2)
      .fontSize(8).font("Helvetica").fillColor(muted)
      .text(`Report generated by Crash Assistant · Msafiri Kenya · ${incidentId}`, { align: "center" });

    doc.end();
  });
}

// ── POST /accidents ───────────────────────────────────────────────────────────
router.post("/accidents", async (req: Request, res: Response) => {
  try {
    const {
      deviceId, lat, lng, roadName, county, nearbyLandmark,
      speedBeforeKmh, speedAtImpactKmh, headingDeg, directionLabel,
      tripStartAt, destinationName, distanceM, durationS,
      dashcamClipId, isManual = false, detectedAt,
    } = req.body as {
      deviceId: string; lat?: number | null; lng?: number | null;
      roadName?: string | null; county?: string | null; nearbyLandmark?: string | null;
      speedBeforeKmh?: number | null; speedAtImpactKmh?: number | null;
      headingDeg?: number | null; directionLabel?: string | null;
      tripStartAt?: string | null; destinationName?: string | null;
      distanceM?: number | null; durationS?: number | null;
      dashcamClipId?: string | null; isManual?: boolean; detectedAt?: string | null;
    };

    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    // Fetch weather in parallel with record creation setup
    const weather = lat != null && lng != null ? await fetchWeather(lat, lng) : null;

    const now = detectedAt ? new Date(detectedAt) : new Date();
    const resolvedDirection = directionLabel ?? headingToDirection(headingDeg ?? null);

    const [record] = await db.insert(accidentRecordsTable).values({
      deviceId,
      isManual: isManual ?? false,
      detectedAt: now,
      lat:               lat != null ? String(lat) : null,
      lng:               lng != null ? String(lng) : null,
      roadName:          roadName ?? null,
      county:            county ?? null,
      nearbyLandmark:    nearbyLandmark ?? null,
      speedBeforeKmh:    speedBeforeKmh != null ? String(speedBeforeKmh) : null,
      speedAtImpactKmh:  speedAtImpactKmh != null ? String(speedAtImpactKmh) : null,
      headingDeg:        headingDeg != null ? String(headingDeg) : null,
      directionLabel:    resolvedDirection,
      tripStartAt:       tripStartAt ? new Date(tripStartAt) : null,
      destinationName:   destinationName ?? null,
      distanceM:         distanceM != null ? String(distanceM) : null,
      durationS:         durationS != null ? String(durationS) : null,
      weatherJson:       weather ? JSON.stringify(weather) : null,
      dashcamClipId:     dashcamClipId ?? null,
    }).returning();

    // Add initial timeline event
    const eventType = isManual ? "manual_report_started" : "crash_detected";
    const description = isManual ? "Accident report started manually" : "Collision detected by Crash Assistant";
    await db.insert(accidentTimelineEventsTable).values({
      accidentId: record.id, eventType, description, occurredAt: now,
    });

    return res.status(201).json({ id: record.id, status: record.status });
  } catch (err) {
    console.error("POST /accidents error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /accidents ────────────────────────────────────────────────────────────
router.get("/accidents", async (req: Request, res: Response) => {
  try {
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const records = await db.select().from(accidentRecordsTable)
      .where(and(
        eq(accidentRecordsTable.deviceId, deviceId),
        ne(accidentRecordsTable.status, "abandoned"),
      ))
      .orderBy(desc(accidentRecordsTable.detectedAt));

    // Attach photo & witness counts
    const ids = records.map((r) => r.id);
    const photoCounts: Record<string, number> = {};
    const witnessCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const photos = await db.select().from(accidentPhotosTable)
        .where(eq(accidentPhotosTable.accidentId, ids[0]!)); // simplified
      // For proper counts, fetch all and count per accidentId
      const allPhotos = await Promise.all(ids.map((id) =>
        db.select().from(accidentPhotosTable).where(eq(accidentPhotosTable.accidentId, id))
          .then((rows) => ({ id, count: rows.length }))
      ));
      const allWitnesses = await Promise.all(ids.map((id) =>
        db.select().from(accidentWitnessesTable).where(eq(accidentWitnessesTable.accidentId, id))
          .then((rows) => ({ id, count: rows.length }))
      ));
      allPhotos.forEach(({ id, count }) => { photoCounts[id] = count; });
      allWitnesses.forEach(({ id, count }) => { witnessCounts[id] = count; });
      void photos; // suppress unused var
    }

    return res.json({
      records: records.map((r) => ({
        id: r.id, status: r.status, isManual: r.isManual,
        detectedAt: r.detectedAt.toISOString(),
        updatedAt: r.updatedAt?.toISOString() ?? null,
        roadName: r.roadName, county: r.county,
        speedBeforeKmh: r.speedBeforeKmh, directionLabel: r.directionLabel,
        otherDriverJson: r.otherDriverJson ?? null,
        pdfUrl: r.pdfUrl ? "/accidents/" + r.id + "/report/url" : null,
        hasPdf: !!r.pdfUrl,
        photoCount: photoCounts[r.id] ?? 0,
        witnessCount: witnessCounts[r.id] ?? 0,
      })),
    });
  } catch (err) {
    console.error("GET /accidents error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /accidents/:id ────────────────────────────────────────────────────────
router.get("/accidents/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const full = await getFullRecord(id, deviceId);
    if (!full) return res.status(404).json({ error: "Not found" });

    const { record: r, photos, witnesses, timeline } = full;

    let weather: object | null = null;
    if (r.weatherJson) { try { weather = JSON.parse(r.weatherJson); } catch { /* */ } }
    let otherDriver: object | null = null;
    if (r.otherDriverJson) { try { otherDriver = JSON.parse(r.otherDriverJson); } catch { /* */ } }
    let police: object | null = null;
    if (r.policeJson) { try { police = JSON.parse(r.policeJson); } catch { /* */ } }

    return res.json({
      id: r.id, status: r.status, isManual: r.isManual,
      detectedAt: r.detectedAt.toISOString(),
      lat: r.lat ? Number(r.lat) : null,
      lng: r.lng ? Number(r.lng) : null,
      roadName: r.roadName, county: r.county, nearbyLandmark: r.nearbyLandmark,
      speedBeforeKmh: r.speedBeforeKmh ? Number(r.speedBeforeKmh) : null,
      speedAtImpactKmh: r.speedAtImpactKmh ? Number(r.speedAtImpactKmh) : null,
      headingDeg: r.headingDeg ? Number(r.headingDeg) : null,
      directionLabel: r.directionLabel,
      tripStartAt: r.tripStartAt?.toISOString() ?? null,
      destinationName: r.destinationName,
      distanceM: r.distanceM ? Number(r.distanceM) : null,
      durationS: r.durationS ? Number(r.durationS) : null,
      dashcamClipId: r.dashcamClipId,
      weather, otherDriver, police,
      driverStatement: r.driverStatement,
      hasPdf: !!r.pdfUrl,
      hasAudioStatement: photos.some((p) => p.category === "audio_statement"),
      photos: photos.map((p) => ({
        id: p.id, category: p.category,
        url: p.fileKey ? `/accidents/${id}/photos/${p.id}/url` : null,
        createdAt: p.createdAt.toISOString(),
      })),
      witnesses: witnesses.map((w) => ({
        id: w.id, name: w.name, phone: w.phone, notes: w.notes,
        createdAt: w.createdAt.toISOString(),
      })),
      timeline: timeline.map((e) => ({
        id: e.id, eventType: e.eventType, description: e.description,
        occurredAt: e.occurredAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /accidents/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /accidents/:id ──────────────────────────────────────────────────────
router.patch("/accidents/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, roadName, county, nearbyLandmark, otherDriver, police, driverStatement, status } = req.body as {
      deviceId: string; roadName?: string; county?: string; nearbyLandmark?: string;
      otherDriver?: object; police?: object; driverStatement?: string; status?: string;
    };
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    // Single atomic UPDATE — ownership + abandoned guard in one statement.
    // If the record was marked abandoned between the client check and this call,
    // the ne() predicate ensures 0 rows are returned → 404.
    const updated = await db.update(accidentRecordsTable).set({
      ...(roadName !== undefined   ? { roadName }                                    : {}),
      ...(county !== undefined     ? { county }                                      : {}),
      ...(nearbyLandmark !== undefined ? { nearbyLandmark }                          : {}),
      ...(otherDriver !== undefined ? { otherDriverJson: JSON.stringify(otherDriver) } : {}),
      ...(police !== undefined     ? { policeJson: JSON.stringify(police) }          : {}),
      ...(driverStatement !== undefined ? { driverStatement }                        : {}),
      ...(status === "complete"    ? { status: "complete" as const }                  : {}),
      ...(status === "archived"    ? { status: "archived" as const }                  : {}),
      updatedAt: new Date(),
    }).where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
      .returning({ id: accidentRecordsTable.id });
    if (!updated.length) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /accidents/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /accidents/:id ─────────────────────────────────────────────────────
router.delete("/accidents/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const deviceId = (req.query.deviceId ?? req.body?.deviceId) as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

    const updated = await db.update(accidentRecordsTable)
      .set({ status: "abandoned", updatedAt: new Date() })
      .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
      .returning({ id: accidentRecordsTable.id });

    if (!updated.length) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /accidents/:id error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /accidents/:id/photos/request-upload ─────────────────────────────────
router.post("/accidents/:id/photos/request-upload", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, category, contentType: rawContentType } = req.body as {
      deviceId: string; category: string; contentType?: string;
    };
    if (!deviceId || !category) return res.status(400).json({ error: "deviceId and category required" });

    const photoId = genId();

    // Allowlist of MIME types the mobile client may send for accident media.
    const ALLOWED_TYPES = new Set([
      "image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif",
      "image/webp", "audio/m4a", "audio/mp4", "audio/aac",
    ]);
    // Client should supply contentType matching what it will PUT; fall back by
    // category so legacy clients that omit the field still work correctly.
    const fallback = category === "audio_statement" ? "audio/m4a" : "image/jpeg";
    const signedContentType =
      rawContentType && ALLOWED_TYPES.has(rawContentType) ? rawContentType : fallback;

    if (!r2.isR2Configured()) {
      return res.status(503).json({ error: "Object storage not configured" });
    }
    const fileKey = `accidents/${id}/photos/${photoId}`;
    const uploadUrl = await r2.getPresignedUploadUrl(fileKey, signedContentType);

    // Atomically re-verify the parent is still active before committing child rows.
    // Presigning happens before the transaction (external I/O must not hold a
    // transaction open), so we accept the presigned URL may be unused if the
    // parent was abandoned in the window — that is harmless.
    let notFound = false;
    await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: accidentRecordsTable.id })
        .from(accidentRecordsTable)
        .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
        .for("update");
      if (!parent) { notFound = true; return; }
      await tx.insert(accidentPhotosTable).values({ id: photoId, accidentId: id, category, fileKey });
      await tx.insert(accidentTimelineEventsTable).values({
        accidentId: id, eventType: "photo_added",
        description: `${category.replace(/_/g, " ")} photo added`,
        occurredAt: new Date(),
      });
    });
    if (notFound) return res.status(404).json({ error: "Not found" });

    return res.json({ photoId, uploadUrl });
  } catch (err) {
    console.error("POST /accidents/:id/photos/request-upload error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /accidents/:id/photos/:photoId/confirm ────────────────────────────────
router.post("/accidents/:id/photos/:photoId/confirm", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const photoId = req.params["photoId"] as string;
    const { deviceId } = req.body as { deviceId: string };
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    // Step 1 — fetch photo fileKey (needed for R2 HEAD; no row lock yet).
    const [photo] = await db.select({ fileKey: accidentPhotosTable.fileKey })
      .from(accidentPhotosTable)
      .where(and(eq(accidentPhotosTable.id, photoId), eq(accidentPhotosTable.accidentId, id)));
    if (!photo) return res.status(404).json({ error: "Photo record not found" });

    // Step 2 — R2 existence check (external I/O; must not be inside a transaction).
    if (r2.isR2Configured() && photo.fileKey) {
      const exists = await r2.headObject(photo.fileKey);
      if (!exists) {
        // Object never landed in storage (PUT failed or was purged). Delete the
        // orphan DB row so it cannot be mistakenly shown as present, then tell
        // the client with 410 Gone so it can surface a retry prompt.
        await db.delete(accidentPhotosTable)
          .where(and(eq(accidentPhotosTable.id, photoId), eq(accidentPhotosTable.accidentId, id)));
        return res.status(410).json({ error: "Photo upload did not reach storage. Please retry." });
      }
    }

    // Step 3 — atomically confirm. FOR UPDATE on the parent serialises against
    // the abandon sweep: if the sweep has not yet committed it waits for this
    // transaction; if it already committed the ne() predicate returns no rows.
    let notFound = false;
    await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: accidentRecordsTable.id })
        .from(accidentRecordsTable)
        .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
        .for("update");
      if (!parent) { notFound = true; return; }
      await tx.update(accidentPhotosTable)
        .set({ storageUrl: "confirmed" })
        .where(and(eq(accidentPhotosTable.id, photoId), eq(accidentPhotosTable.accidentId, id)));
    });
    if (notFound) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /accidents/:id/photos/:photoId/confirm error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /accidents/:id/photos/:photoId/url ────────────────────────────────────
router.get("/accidents/:id/photos/:photoId/url", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const photoId = req.params["photoId"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [record] = await db.select({ id: accidentRecordsTable.id }).from(accidentRecordsTable)
      .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")));
    if (!record) return res.status(404).json({ error: "Not found" });

    const [photo] = await db.select().from(accidentPhotosTable)
      .where(and(eq(accidentPhotosTable.id, photoId), eq(accidentPhotosTable.accidentId, id)));
    if (!photo?.fileKey) return res.status(404).json({ error: "Photo not found" });

    const url = await signedDownloadUrl(photo.fileKey, 3600);
    return res.json({ url });
  } catch (err) {
    console.error("GET photo url error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /accidents/:id/photos/:photoId ─────────────────────────────────────
router.delete("/accidents/:id/photos/:photoId", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const photoId = req.params["photoId"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    let notFound = false;
    await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: accidentRecordsTable.id }).from(accidentRecordsTable)
        .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
        .for("update");
      if (!parent) { notFound = true; return; }
      await tx.delete(accidentPhotosTable)
        .where(and(eq(accidentPhotosTable.id, photoId), eq(accidentPhotosTable.accidentId, id)));
    });
    if (notFound) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    console.error("DELETE photo error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /accidents/:id/witnesses ─────────────────────────────────────────────
router.post("/accidents/:id/witnesses", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, name, phone, notes } = req.body as {
      deviceId: string; name: string; phone?: string; notes?: string;
    };
    if (!deviceId || !name) return res.status(400).json({ error: "deviceId and name required" });

    let notFound = false;
    let witness: typeof accidentWitnessesTable.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: accidentRecordsTable.id }).from(accidentRecordsTable)
        .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
        .for("update");
      if (!parent) { notFound = true; return; }
      [witness] = await tx.insert(accidentWitnessesTable)
        .values({ accidentId: id, name, phone: phone ?? null, notes: notes ?? null })
        .returning();
    });
    if (notFound) return res.status(404).json({ error: "Not found" });

    return res.status(201).json({ id: witness!.id, name: witness!.name, phone: witness!.phone, notes: witness!.notes });
  } catch (err) {
    console.error("POST witnesses error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /accidents/:id/witnesses/:witnessId ────────────────────────────────
router.delete("/accidents/:id/witnesses/:witnessId", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const witnessId = req.params["witnessId"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    let notFound = false;
    await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: accidentRecordsTable.id }).from(accidentRecordsTable)
        .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
        .for("update");
      if (!parent) { notFound = true; return; }
      await tx.delete(accidentWitnessesTable)
        .where(and(eq(accidentWitnessesTable.id, witnessId), eq(accidentWitnessesTable.accidentId, id)));
    });
    if (notFound) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    console.error("DELETE witness error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /accidents/:id/timeline-event ────────────────────────────────────────
router.post("/accidents/:id/timeline-event", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const { deviceId, eventType, description, occurredAt } = req.body as {
      deviceId: string; eventType: string; description?: string; occurredAt?: string;
    };
    if (!deviceId || !eventType) return res.status(400).json({ error: "deviceId and eventType required" });

    let notFound = false;
    await db.transaction(async (tx) => {
      const [parent] = await tx.select({ id: accidentRecordsTable.id }).from(accidentRecordsTable)
        .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
        .for("update");
      if (!parent) { notFound = true; return; }
      await tx.insert(accidentTimelineEventsTable).values({
        accidentId: id, eventType, description: description ?? null,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      });
    });
    if (notFound) return res.status(404).json({ error: "Not found" });

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("POST timeline-event error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /accidents/:id/report ─────────────────────────────────────────────────
// Generates PDF if not cached, stores in object storage, returns download URL.
router.get("/accidents/:id/report", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const full = await getFullRecord(id, deviceId);
    if (!full) return res.status(404).json({ error: "Not found" });

    const { record, photos, witnesses, timeline } = full;

    // Return cached PDF URL if already generated
    if (record.pdfUrl && record.pdfFileKey) {
      try {
        const url = await signedDownloadUrl(record.pdfFileKey, 3600 * 24);
        return res.json({ url, cached: true });
      } catch { /* re-generate below */ }
    }

    // Generate PDF
    const pdfBuffer = await generatePdf(record, photos, witnesses, timeline);

    // Upload to R2 (only backend — legacy GCS retired)
    if (!r2.isR2Configured()) {
      return res.status(503).json({ error: "Object storage not configured" });
    }
    const fileKey = `accidents/${id}/report.pdf`;
    await r2.uploadBuffer(fileKey, pdfBuffer, "application/pdf");
    const url = await signedDownloadUrl(fileKey, 3600 * 24);

    // Atomically mark complete and insert the timeline event only if the sweep
    // has not yet abandoned this record.  Zero returning rows means the sweep
    // won the race; skip the timeline insert and surface a conflict error so
    // the client knows the report is available but the record is abandoned.
    const updatedRows = await db.update(accidentRecordsTable)
      .set({ pdfUrl: url, pdfFileKey: fileKey, status: "complete", updatedAt: new Date() })
      .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")))
      .returning({ id: accidentRecordsTable.id });

    if (!updatedRows.length) {
      // PDF is already in R2 and the URL is valid, but we cannot mark the
      // record complete.  Return 409 so the client can surface a useful error.
      return res.status(409).json({ error: "Record was abandoned while generating the report. The PDF is ready but the report cannot be saved." });
    }

    // Only write the timeline event if the parent UPDATE committed.
    await db.insert(accidentTimelineEventsTable).values({
      accidentId: id, eventType: "report_generated",
      description: "PDF report generated", occurredAt: new Date(),
    });

    return res.json({ url, cached: false });
  } catch (err) {
    console.error("GET /accidents/:id/report error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /accidents/:id/report/url ─────────────────────────────────────────────
// Returns a fresh signed URL for an already-generated PDF.
router.get("/accidents/:id/report/url", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    const deviceId = req.query.deviceId as string;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const [record] = await db.select({ pdfFileKey: accidentRecordsTable.pdfFileKey })
      .from(accidentRecordsTable)
      .where(and(eq(accidentRecordsTable.id, id), eq(accidentRecordsTable.deviceId, deviceId), ne(accidentRecordsTable.status, "abandoned")));

    if (!record?.pdfFileKey) return res.status(404).json({ error: "No PDF generated yet" });

    const url = await signedDownloadUrl(record.pdfFileKey, 3600 * 24);
    return res.json({ url });
  } catch (err) {
    console.error("GET /accidents/:id/report/url error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
