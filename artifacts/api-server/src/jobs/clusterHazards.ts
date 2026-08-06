/**
 * clusterHazards — runs every 30 minutes.
 *
 * Groups braking_events from the last 7 days into 60-metre spatial clusters
 * using a pure-SQL haversine self-join approach (no PostGIS required).
 * When a cluster has ≥ 5 distinct device IDs and no linked community report
 * already exists, it auto-creates a community report with source='auto'.
 */
import { db, brakingEventsTable, hazardClustersTable, communityReportsTable } from "@workspace/db";
import { sql, and, gte, eq } from "drizzle-orm";
import { subDays } from "date-fns";
import { logger } from "../lib/logger.js";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const CLUSTER_RADIUS_KM = 0.06;     // 60 metres
const MIN_DEVICES = 5;
const LOOKBACK_DAYS = 7;

// Map dominant event type → community report type
const EVENT_TO_REPORT_TYPE: Record<string, string> = {
  hard_braking: "hazard",
  pothole:      "pothole",
  swerve:       "hazard",
};

async function runClusterHazards(): Promise<void> {
  const since = subDays(new Date(), LOOKBACK_DAYS);

  // Pull all recent events — we do the clustering in-process using a simple
  // greedy approach: sort by createdAt, assign each event to the first existing
  // cluster centroid within 60 m, or start a new cluster.
  const events = await db
    .select({
      id:        brakingEventsTable.id,
      deviceId:  brakingEventsTable.deviceId,
      eventType: brakingEventsTable.eventType,
      lat:       brakingEventsTable.lat,
      lng:       brakingEventsTable.lng,
      gForce:    brakingEventsTable.gForce,
    })
    .from(brakingEventsTable)
    .where(gte(brakingEventsTable.createdAt, since));

  if (events.length === 0) return;

  // Greedy spatial clustering (O(n·k) where k = number of clusters so far)
  type Cluster = {
    lat: number; lng: number;
    devices: Set<string>;
    counts: Record<string, number>; // eventType → count
    eventCount: number;
  };

  const clusters: Cluster[] = [];

  function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  for (const ev of events) {
    let assigned = false;
    for (const c of clusters) {
      if (haversineKm(c.lat, c.lng, ev.lat, ev.lng) <= CLUSTER_RADIUS_KM) {
        c.devices.add(ev.deviceId);
        c.counts[ev.eventType] = (c.counts[ev.eventType] ?? 0) + 1;
        c.eventCount++;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.push({
        lat: ev.lat,
        lng: ev.lng,
        devices: new Set([ev.deviceId]),
        counts: { [ev.eventType]: 1 },
        eventCount: 1,
      });
    }
  }

  // Only process clusters with enough distinct devices
  const candidates = clusters.filter((c) => c.devices.size >= MIN_DEVICES);
  if (candidates.length === 0) return;

  // Load existing hazard clusters so we can skip already-processed ones
  const existingClusters = await db
    .select({ clusterLat: hazardClustersTable.clusterLat, clusterLng: hazardClustersTable.clusterLng })
    .from(hazardClustersTable);

  let created = 0;
  for (const c of candidates) {
    // Skip if we already have a cluster at this location (within 60 m)
    const alreadyExists = existingClusters.some(
      (ec) => haversineKm(ec.clusterLat, ec.clusterLng, c.lat, c.lng) <= CLUSTER_RADIUS_KM
    );
    if (alreadyExists) continue;

    const dominantType = (Object.entries(c.counts).sort((a, b) => b[1] - a[1])[0]?.[0]) ?? "hard_braking";
    const reportType = EVENT_TO_REPORT_TYPE[dominantType] ?? "hazard";
    const deviceCount = c.devices.size;
    const description = `Auto-detected: ${deviceCount} drivers reported ${dominantType.replace("_", " ")} here`;

    // Create the community report
    const [report] = await db
      .insert(communityReportsTable)
      .values({
        type:        reportType,
        lat:         c.lat,
        lng:         c.lng,
        deviceId:    "auto-detection-system",
        status:      "active",
        confirmCount: deviceCount,
        source:      "auto",
        roadName:    description,
      })
      .returning({ id: communityReportsTable.id });

    if (!report) continue;

    // Link the cluster to the report
    await db.insert(hazardClustersTable).values({
      reportId:     report.id,
      clusterLat:   c.lat,
      clusterLng:   c.lng,
      dominantType,
      deviceCount,
      eventCount:   c.eventCount,
    });

    created++;
  }

  if (created > 0) {
    logger.info({ created, candidateClusters: candidates.length }, "clusterHazards: auto-created hazard reports");
  }
}

export function startClusterHazardsJob(): NodeJS.Timeout {
  logger.info({ intervalMs: INTERVAL_MS }, "clusterHazards job started");

  // Run once at startup (delayed 10 s so the DB is ready)
  setTimeout(() => {
    runClusterHazards().catch((err) => logger.warn({ err }, "clusterHazards: initial run failed"));
  }, 10_000);

  return setInterval(() => {
    runClusterHazards().catch((err) => logger.warn({ err }, "clusterHazards: interval run failed"));
  }, INTERVAL_MS);
}
