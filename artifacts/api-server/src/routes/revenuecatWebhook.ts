import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  db,
  creatorBenefitsTable,
  creatorSubscriptionEventsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorizationToken(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, "");
}

export function authorizationMatches(received: string, configured: string): boolean {
  const receivedToken = authorizationToken(received);
  const configuredToken = authorizationToken(configured);
  return Boolean(receivedToken && configuredToken && safeEqual(receivedToken, configuredToken));
}

function toDate(value: unknown): Date | null {
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

export function statusForEvent(type: string, expiresAt: Date | null, now = new Date()): string | null {
  if (["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED"].includes(type)) {
    return "active";
  }
  if (type === "CANCELLATION") {
    return expiresAt && expiresAt > now ? "cancel_pending" : "expired";
  }
  if (type === "EXPIRATION") return "expired";
  if (type === "BILLING_ISSUE") return "grace";
  if (["REFUND", "SUBSCRIPTION_PAUSED"].includes(type)) return "revoked";
  return null;
}

export function shouldApplyLifecycleEvent(input: {
  productId: string | null;
  allowedProductIds: Set<string>;
  eventAt: Date;
  lastEventAt: Date | null;
}): boolean {
  return Boolean(
    input.productId &&
    input.allowedProductIds.has(input.productId) &&
    (!input.lastEventAt || input.eventAt >= input.lastEventAt),
  );
}

router.post("/webhooks/revenuecat", async (req: Request, res: Response) => {
  const configured = process.env["REVENUECAT_WEBHOOK_AUTH"];
  if (!configured) return res.status(503).json({ error: "RevenueCat webhook is not configured" });

  const authorization = req.get("authorization") ?? "";
  if (!authorizationMatches(authorization, configured)) {
    return res.status(401).json({ error: "Invalid webhook authorization" });
  }

  const event = req.body?.event;
  if (!event || typeof event !== "object") {
    return res.status(400).json({ error: "Invalid RevenueCat event" });
  }

  const eventId = String(event.id ?? "");
  const appUserId = String(event.app_user_id ?? "");
  const eventType = String(event.type ?? "");
  if (!eventId || !appUserId || !eventType) {
    return res.status(400).json({ error: "event.id, event.app_user_id and event.type are required" });
  }

  try {
    const [benefit] = await db
      .select()
      .from(creatorBenefitsTable)
      .where(and(
        eq(creatorBenefitsTable.revenuecatAppUserId, appUserId),
        eq(creatorBenefitsTable.bindingVerified, true),
      ))
      .limit(1);

    const purchasedAt = toDate(event.purchased_at_ms ?? event.purchased_at);
    const expiresAt = toDate(event.expiration_at_ms ?? event.expires_at);
    const platform = typeof event.store === "string" ? event.store.toLowerCase() : null;
    const productId = typeof event.product_id === "string" ? event.product_id : null;
    const transactionId =
      typeof event.transaction_id === "string"
        ? event.transaction_id
        : typeof event.original_transaction_id === "string"
          ? event.original_transaction_id
          : null;
    const periodType = typeof event.period_type === "string" ? event.period_type : null;
    const eventAt = toDate(event.event_timestamp_ms ?? event.event_timestamp) ?? new Date();
    const allowedProductIds = new Set(
      (process.env["CREATOR_PRODUCT_IDS"] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const applyLifecycle = benefit
      ? shouldApplyLifecycleEvent({
          productId,
          allowedProductIds,
          eventAt,
          lastEventAt: benefit.lastEventAt,
        })
      : false;

    const inserted = await db
      .insert(creatorSubscriptionEventsTable)
      .values({
        eventId,
        applicationId: benefit?.applicationId ?? null,
        appUserId,
        eventType,
        productId,
        platform,
        transactionId,
        purchasedAt,
        expiresAt,
        periodType,
        matchStatus: benefit ? (applyLifecycle ? "matched" : "matched_ignored") : "unmatched",
        rawEvent: event as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: creatorSubscriptionEventsTable.id });

    if (inserted.length === 0) return res.json({ received: true, duplicate: true });

    const nextStatus = statusForEvent(eventType, expiresAt);
    if (benefit && nextStatus && applyLifecycle) {
      await db
        .update(creatorBenefitsTable)
        .set({
          status: nextStatus,
          productId,
          platform: platform ?? benefit.platform,
          transactionId,
          periodType,
          ...(purchasedAt ? { offerStartedAt: purchasedAt } : {}),
          ...(expiresAt ? { offerExpiresAt: expiresAt } : {}),
          lastEventAt: eventAt,
          ...(nextStatus === "revoked"
            ? { revokedAt: new Date(), revocationReason: eventType.toLowerCase() }
            : { revokedAt: null, revocationReason: null }),
          updatedAt: new Date(),
        })
        .where(eq(creatorBenefitsTable.applicationId, benefit.applicationId));
    }

    if (!benefit) {
      logger.warn({ eventId, appUserId, eventType }, "RevenueCat creator event could not be attributed");
    }
    return res.json({ received: true, matched: Boolean(benefit) });
  } catch (err) {
    logger.error({ err, eventId }, "RevenueCat creator webhook failed");
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;