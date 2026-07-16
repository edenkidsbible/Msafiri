import { Router, type Request, type Response } from "express";
import { db, communityReportsTable, creatorApplicationsTable, adminUsersTable } from "@workspace/db";
import { or, ilike, sql } from "drizzle-orm";
import type { AdminJwtPayload } from "../../middleware/adminAuth.js";

const router = Router();

const RESULT_LIMIT = 5;

// ── GET /admin/search?q= — one query fanned out across every section the
// requesting admin is allowed to see. Each section is a small, limited
// ILIKE lookup — good enough for jumping to a record, not a full-text engine. ──
router.get("/search", async (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) ?? "").trim();
    const actor = (req as any).adminUser as AdminJwtPayload;
    const can = (feature: string) => actor.effectivePermissions?.includes(feature as any) ?? false;

    if (q.length < 2) {
      return res.json({ reports: [], creators: [], subscribers: [], users: [] });
    }

    const like = `%${q}%`;

    // Every section is gated on the same effective-permission set the caller's
    // own pages are gated on — a custom grant/revoke in Team Members changes
    // what shows up here too, not just the role default.
    const reportsPromise = can("reports")
      ? db
          .select({
            id: communityReportsTable.id,
            type: communityReportsTable.type,
            roadName: communityReportsTable.roadName,
            status: communityReportsTable.status,
            lat: communityReportsTable.lat,
            lng: communityReportsTable.lng,
          })
          .from(communityReportsTable)
          .where(
            or(
              ilike(communityReportsTable.roadName, like),
              ilike(communityReportsTable.type, like),
              sql`${communityReportsTable.id}::text ILIKE ${like}`
            )
          )
          .limit(RESULT_LIMIT)
      : Promise.resolve([]);

    const creatorsPromise = can("creators")
      ? db
          .select({
            id: creatorApplicationsTable.id,
            name: creatorApplicationsTable.name,
            email: creatorApplicationsTable.email,
            status: creatorApplicationsTable.status,
          })
          .from(creatorApplicationsTable)
          .where(
            or(
              ilike(creatorApplicationsTable.name, like),
              ilike(creatorApplicationsTable.email, like),
              ilike(creatorApplicationsTable.deviceId, like)
            )
          )
          .limit(RESULT_LIMIT)
      : Promise.resolve([]);

    // Subscribers live in RevenueCat, not our DB — there's no bulk-search API
    // there, only exact app-user-id lookup, so we only attempt it when the
    // query looks like a plausible id (no spaces) and skip it otherwise.
    const subscribersPromise = can("subscribers") && !/\s/.test(q)
      ? lookupSubscriberByAppUserId(q)
      : Promise.resolve([]);

    const usersPromise = can("team")
      ? db
          .select({
            id: adminUsersTable.id,
            name: adminUsersTable.name,
            email: adminUsersTable.email,
            role: adminUsersTable.role,
          })
          .from(adminUsersTable)
          .where(or(ilike(adminUsersTable.name, like), ilike(adminUsersTable.email, like)))
          .limit(RESULT_LIMIT)
      : Promise.resolve([]);

    const [reports, creators, subscribers, users] = await Promise.all([
      reportsPromise,
      creatorsPromise,
      subscribersPromise,
      usersPromise,
    ]);

    return res.json({ reports, creators, subscribers, users });
  } catch (err) {
    console.error("GET /admin/search error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

async function lookupSubscriberByAppUserId(
  appUserId: string
): Promise<Array<{ id: string; appUserId: string; hasActiveEntitlement: boolean }>> {
  try {
    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();

    // Use pinned project ID — items[0] risks hitting a different project in a
    // shared RevenueCat account. See REVENUECAT_PROJECT_ID env var.
    const pinnedId = process.env["REVENUECAT_PROJECT_ID"];
    let projectId: string | null = pinnedId ?? null;

    if (!projectId) {
      const projectsResp = await connectors.proxy("revenuecat", "/v2/projects?limit=10", { method: "GET" });
      if (!projectsResp.ok) return [];
      const projectsData = (await projectsResp.json()) as any;
      projectId = projectsData?.items?.[0]?.id ?? null;
    }

    if (!projectId) return [];

    const customerResp = await connectors.proxy(
      "revenuecat",
      `/v2/projects/${projectId}/customers/${encodeURIComponent(appUserId)}`,
      { method: "GET" }
    );
    if (!customerResp.ok) return [];

    const c = (await customerResp.json()) as any;
    const hasActiveEntitlement =
      Array.isArray(c.entitlements) &&
      c.entitlements.some((e: any) => e.expires_date === null || new Date(e.expires_date) > new Date());

    return [{ id: c.id, appUserId: c.app_user_id ?? c.id, hasActiveEntitlement }];
  } catch {
    return [];
  }
}

export default router;
