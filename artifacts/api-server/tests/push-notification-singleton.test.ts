import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const jobSource = readFileSync(
  new URL("../src/jobs/pushNotifications.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(
  new URL("../src/routes/admin/push-campaigns.ts", import.meta.url),
  "utf8",
);

describe("push notification singleton delivery", () => {
  it("atomically claims each automatic campaign type across workers", () => {
    expect(jobSource).toContain("pg_try_advisory_xact_lock");
    expect(jobSource).toContain("hashtextextended(${type}, 0)");
  });

  it("atomically transitions scheduled campaigns before sending", () => {
    expect(jobSource).toMatch(
      /eq\(pushCampaignsTable\.status,\s*"scheduled"\)[\s\S]*?returning\(\{ id: pushCampaignsTable\.id \}\)/,
    );
    expect(jobSource).toContain("if (claimed.length === 0) continue");
  });

  it("deduplicates automatic, scheduled, and manual recipients by physical device", () => {
    expect(jobSource.match(/DISTINCT ON \(COALESCE\(vendor_id, device_id\)\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(routeSource).toContain("DISTINCT ON (COALESCE(vendor_id, device_id))");
  });
});