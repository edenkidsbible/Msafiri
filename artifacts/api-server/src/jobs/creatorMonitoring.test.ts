import { describe, expect, it } from "vitest";
import { evaluateCreatorActivity, selectActivityAnchor } from "./creatorMonitoring.js";
import {
  authorizationMatches,
  shouldApplyLifecycleEvent,
  statusForEvent,
} from "../routes/revenuecatWebhook.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-27T12:00:00.000Z");

describe("creator activity policy", () => {
  it("accepts the same webhook secret with or without a Bearer prefix", () => {
    expect(authorizationMatches("creator-secret", "creator-secret")).toBe(true);
    expect(authorizationMatches("Bearer creator-secret", "creator-secret")).toBe(true);
    expect(authorizationMatches("creator-secret", "Bearer creator-secret")).toBe(true);
    expect(authorizationMatches("Bearer wrong-secret", "creator-secret")).toBe(false);
    expect(authorizationMatches("", "creator-secret")).toBe(false);
  });

  it("never starts the inactivity clock before benefit activation", () => {
    const activatedAt = new Date(now.getTime() - 2 * DAY);
    const historicalReport = new Date(now.getTime() - 30 * DAY);
    expect(selectActivityAnchor(activatedAt, historicalReport)).toEqual(activatedAt);
  });

  it("uses a qualifying report made after activation as the new anchor", () => {
    const activatedAt = new Date(now.getTime() - 6 * DAY);
    const recentReport = new Date(now.getTime() - DAY);
    expect(selectActivityAnchor(activatedAt, recentReport)).toEqual(recentReport);
  });

  it("does not enforce an active state without a defined activation anchor", () => {
    expect(selectActivityAnchor(null, new Date(now.getTime() - 30 * DAY))).toBeNull();
  });

  it("does nothing before three inactive days", () => {
    expect(evaluateCreatorActivity({
      now,
      activityAnchor: new Date(now.getTime() - 2 * DAY),
      lastReminderAt: null,
    }).decision).toBe("none");
  });

  it("reminds after three days and observes the cooldown", () => {
    expect(evaluateCreatorActivity({
      now,
      activityAnchor: new Date(now.getTime() - 4 * DAY),
      lastReminderAt: null,
    }).decision).toBe("remind");
    expect(evaluateCreatorActivity({
      now,
      activityAnchor: new Date(now.getTime() - 4 * DAY),
      lastReminderAt: new Date(now.getTime() - DAY),
    }).decision).toBe("none");
  });

  it("revokes at seven inactive days regardless of reminder state", () => {
    expect(evaluateCreatorActivity({
      now,
      activityAnchor: new Date(now.getTime() - 7 * DAY),
      lastReminderAt: now,
    }).decision).toBe("revoke");
  });
});

describe("RevenueCat lifecycle mapping", () => {
  it("rejects unrelated products and stale events", () => {
    const allowedProductIds = new Set(["creator_monthly"]);
    expect(shouldApplyLifecycleEvent({
      productId: "unrelated_product",
      allowedProductIds,
      eventAt: now,
      lastEventAt: null,
    })).toBe(false);
    expect(shouldApplyLifecycleEvent({
      productId: "creator_monthly",
      allowedProductIds,
      eventAt: new Date(now.getTime() - DAY),
      lastEventAt: now,
    })).toBe(false);
    expect(shouldApplyLifecycleEvent({
      productId: "creator_monthly",
      allowedProductIds,
      eventAt: now,
      lastEventAt: new Date(now.getTime() - DAY),
    })).toBe(true);
  });

  it("activates purchases and renewals", () => {
    expect(statusForEvent("INITIAL_PURCHASE", null, now)).toBe("active");
    expect(statusForEvent("RENEWAL", null, now)).toBe("active");
  });

  it("keeps a cancelled subscription pending until its expiry", () => {
    expect(statusForEvent("CANCELLATION", new Date(now.getTime() + DAY), now)).toBe("cancel_pending");
    expect(statusForEvent("CANCELLATION", new Date(now.getTime() - DAY), now)).toBe("expired");
  });

  it("revokes refunds and ignores unrelated event types", () => {
    expect(statusForEvent("REFUND", null, now)).toBe("revoked");
    expect(statusForEvent("TEST", null, now)).toBeNull();
  });
});