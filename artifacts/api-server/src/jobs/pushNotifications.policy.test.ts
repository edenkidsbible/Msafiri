import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./pushNotifications.ts", import.meta.url), "utf8");

function functionBody(name: string): string {
  const start = source.indexOf(`async function ${name}`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const nextSection = source.indexOf("\n// ─", start + 1);
  return source.slice(start, nextSection < 0 ? source.length : nextSection);
}

describe("automatic push notification policy", () => {
  it("allows one daily usage-tip window at 13:00 EAT", () => {
    expect(source).toContain('const DAILY_USAGE_TIP_TYPE = "daily_usage_tip"');
    expect(source).toContain("const DAILY_USAGE_TIP_HOUR_EAT = 13");

    const dailyTriggers = functionBody("checkDailyTriggers");
    expect(dailyTriggers).toContain("sendActiveCampaign(DAILY_USAGE_TIP_TYPE");
    expect(dailyTriggers).not.toMatch(/daily_morning|daily_midday|daily_evening/);
    expect(dailyTriggers).not.toMatch(/weekend_night_safety|engagement/);
  });

  it("does not automatically deliver generic scheduled or planned-trip road campaigns", () => {
    const runJob = functionBody("runJob");
    expect(runJob).toContain("cancelPendingScheduledCampaigns()");
    expect(runJob).not.toMatch(/processScheduledCampaigns|checkPlannedTrips/);
  });

  it("cancels pending generic scheduled campaigns without sending them", () => {
    const cancellation = functionBody("cancelPendingScheduledCampaigns");
    expect(cancellation).toContain('.set({ status: "cancelled" })');
    expect(cancellation).not.toContain("sendPushNotifications");
  });
});