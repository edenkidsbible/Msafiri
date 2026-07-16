import { Router, type Request, type Response } from "express";

const router = Router();

// GET /admin/subscribers
// Fetches subscriber summary from RevenueCat via the Replit connectors proxy
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
    let total = 0;

    if (customersResp.ok) {
      const customersData = await customersResp.json() as any;
      customers = customersData?.items ?? [];
      total = customersData?.next_page ? customers.length : customers.length;
    }

    const mapped = customers.map((c: any) => ({
      id:                c.id,
      appUserId:         c.app_user_id ?? c.id,
      lastSeenAt:        c.last_seen_at ?? null,
      country:           c.country ?? null,
      hasActiveEntitlement: Array.isArray(c.entitlements) && c.entitlements.some((e: any) => e.expires_date === null || new Date(e.expires_date) > new Date()),
    }));

    const activeCount = mapped.filter((c) => c.hasActiveEntitlement).length;

    return res.json({
      subscribers:        mapped,
      total,
      projectName:        project.name ?? project.id,
      activeSubscribers:  activeCount,
      trialSubscribers:   0,
    });
  } catch (err) {
    console.error("GET /admin/subscribers error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
