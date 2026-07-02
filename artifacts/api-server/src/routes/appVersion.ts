import { Router, type Request, type Response } from "express";
import { db, appReleasesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

/** Parse "1.2.3" into [1,2,3] for numeric comparison */
function parseSemver(v: string): [number, number, number] {
  const parts = v.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Returns -1, 0, or 1 */
function semverCmp(a: string, b: string): number {
  const [aMaj, aMin, aPat] = parseSemver(a);
  const [bMaj, bMin, bPat] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

/**
 * GET /app/version?platform=ios&version=1.0.0&build=1
 *
 * Returns the latest live release and the minimum required version.
 * The client uses this to decide whether to show a force-update screen
 * or a soft-update prompt.
 */
router.get("/app/version", async (req: Request, res: Response) => {
  try {
    const platform = (req.query["platform"] as string) ?? "all";
    const clientVersion = (req.query["version"] as string) ?? "0.0.0";
    const clientBuild = parseInt((req.query["build"] as string) ?? "0", 10);

    // Get all live releases, newest first
    const liveReleases = await db
      .select()
      .from(appReleasesTable)
      .where(eq(appReleasesTable.status, "live"))
      .orderBy(desc(appReleasesTable.publishedAt));

    if (liveReleases.length === 0) {
      return res.json({
        latestVersion:      null,
        latestBuild:        null,
        minRequiredVersion: null,
        minRequiredBuild:   null,
        isForceRequired:    false,
        updateAvailable:    false,
        releaseNotes:       null,
        storeUrlIos:        null,
        storeUrlAndroid:    null,
      });
    }

    // Filter by platform (releases for "all" apply to everyone)
    const applicable = liveReleases.filter(
      (r) => r.platform === "all" || r.platform === platform
    );

    if (applicable.length === 0) {
      return res.json({
        latestVersion:      null,
        latestBuild:        null,
        minRequiredVersion: null,
        minRequiredBuild:   null,
        isForceRequired:    false,
        updateAvailable:    false,
        releaseNotes:       null,
        storeUrlIos:        null,
        storeUrlAndroid:    null,
      });
    }

    // Sort by semver to find actual latest
    const sorted = [...applicable].sort((a, b) => semverCmp(b.version, a.version));
    const latest = sorted[0]!;

    // Minimum required version = the highest force-update release
    const forceReleases = applicable.filter((r) => r.isForceUpdate);
    const forceSorted = [...forceReleases].sort((a, b) =>
      semverCmp(b.version, a.version)
    );
    const minRelease = forceSorted[0] ?? null;

    const minRequiredVersion = minRelease?.version ?? null;
    const minRequiredBuild   = minRelease?.buildNumber ?? null;

    const isForceRequired =
      minRequiredVersion !== null
        ? semverCmp(clientVersion, minRequiredVersion) < 0
        : false;

    const updateAvailable = semverCmp(clientVersion, latest.version) < 0;

    // Pick the most informative release notes: the latest release the client
    // doesn't have yet (or the force release if upgrade is required)
    const relevantRelease =
      isForceRequired && minRelease ? minRelease : (updateAvailable ? latest : null);

    return res.json({
      latestVersion:      latest.version,
      latestBuild:        latest.buildNumber,
      minRequiredVersion,
      minRequiredBuild,
      isForceRequired,
      updateAvailable,
      releaseNotes:       relevantRelease?.releaseNotes ?? null,
      storeUrlIos:        latest.storeUrlIos ?? null,
      storeUrlAndroid:    latest.storeUrlAndroid ?? null,
    });
  } catch (err) {
    console.error("GET /app/version error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
