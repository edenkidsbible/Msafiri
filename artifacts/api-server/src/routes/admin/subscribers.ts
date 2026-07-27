import { Router, type Request, type Response } from "express";

const router = Router();

// GET /admin/subscribers
// Fetches subscriber summary from RevenueCat via the Replit connectors proxy.
// Only returns customers with production entitlements — sandbox/test accounts
// that used development purchases are automatically filtered out.
router.get("/subscribers", async (_req: Request, res: Response) => {
  try {
    const { ReplitConnectors } = await import("@replit/connectors-sdk");
    const connectors = new ReplitConnectors();

    // Resolve the project ID from the pinned env var first.
    // Falling back to items[0] from the projects list risks targeting a
    // different product's project when the RevenueCat account is shared.
    const pinnedId = process.env["REVENUECAT_PROJECT_ID"];
    let project: { id: string; name: string } | null = null;

    if (pinnedId) {
      project = { id: pinnedId, name: "Msafiri Kenya" };
    } else {
      const projectsResp = await connectors.proxy("revenuecat", "/v2/projects?limit=10", {
        method: "GET",
      });
      if (!projectsResp.ok) {
        const text = await projectsResp.text();
        console.error("RC projects error:", text);
        return res.status(502).json({ error: "Failed to reach RevenueCat", detail: text });
      }
      const projectsData = await projectsResp.json() as any;
      project = projectsData?.items?.[0] ?? null;
    }

    if (!project) {
      return res.json({ subscribers: [], total: 0, projectName: null, activeSubscribers: 0, trialSubscribers: 0 });
    }

    // Fetch customers for the project
    const customersResp = await connectors.proxy(
      "revenuecat",
      `/v2/projects/${project.id}/customers?limit=100`,
      { method: "GET" }
    );

    let customers: any[] = [];

    if (customersResp.ok) {
      const customersData = await customersResp.json() as any;
      customers = customersData?.items ?? [];
    }

    // The 3-day trial window used in the app
    const TRIAL_DAYS = 3;

    const mapped = customers
      .map((c: any): any | null => {
        const allEntitlements: any[] = Array.isArray(c.entitlements) ? c.entitlements : [];

        // Split into production vs sandbox entitlements.
        // If environment field is absent we trust it (legacy / promotional grants).
        const productionEntitlements = allEntitlements.filter(
          (e: any) => e.environment !== "SANDBOX"
        );

        // Customers whose ONLY entitlements are sandbox purchases are test accounts — skip them.
        if (allEntitlements.length > 0 && productionEntitlements.length === 0) {
          return null;
        }

        // Active = not yet expired production entitlement
        const activeProduction = productionEntitlements.filter(
          (e: any) =>
            e.expires_date == null || new Date(e.expires_date) > new Date()
        );

        const hasActiveEntitlement = activeProduction.length > 0;

        // Trial detection: explicit period_type flag OR purchase within trial window
        const isOnTrial = hasActiveEntitlement && activeProduction.some((e: any) => {
          if (e.period_type === "TRIAL") return true;
          if (e.purchase_date) {
            const daysSince = (Date.now() - new Date(e.purchase_date).getTime()) / 86_400_000;
            return daysSince <= TRIAL_DAYS;
          }
          return false;
        });

        return {
          id:                  c.id,
          appUserId:           c.app_user_id ?? c.id,
          lastSeenAt:          c.last_seen_at ?? null,
          country:             c.country ?? null,
          hasActiveEntitlement,
          isOnTrial,
        };
      })
      .filter((c: any): c is NonNullable<typeof c> => c !== null);

    const activeCount = mapped.filter((c) => c.hasActiveEntitlement && !c.isOnTrial).length;
    const trialCount  = mapped.filter((c) => c.isOnTrial).length;

    return res.json({
      subscribers:       mapped,
      total:             mapped.length,
      projectName:       project.name ?? project.id,
      activeSubscribers: activeCount,
      trialSubscribers:  trialCount,
    });
  } catch (err) {
    console.error("GET /admin/subscribers error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
