# Creator attribution and monitoring

## What is tracked

- Creator applications remain the approval record.
- Creator benefits track the linked report device, RevenueCat app user, offer state, reminder state, and manual or automatic revocation.
- Device and RevenueCat identifiers submitted by the app are untrusted claims until an admin explicitly chooses **Verify Identity & Grant**. Unverified claims never drive activity or lifecycle enforcement.
- RevenueCat webhook events are stored idempotently by event ID. Unknown app-user IDs remain explicitly unmatched and are never assigned heuristically.
- Promo-code assignment and email delivery are displayed as `assigned`; neither is treated as redemption.

## Activity policy

- Qualifying activity is a manual community report that an admin has independently verified. Raw client submissions and community votes cannot extend creator benefits.
- Only creators whose claimed device/subscription identity has been admin-verified enter monitoring. A verified device or RevenueCat identity can belong to only one creator.
- At three inactive days, the system may send push and email reminders.
- Reminder cooldown is three days.
- At seven inactive days, the Msafiri creator benefit is marked revoked.
- Reports made before benefit activation do not count against or advance the inactivity clock.
- Manual Restore resets the activity clock to the restore time.
- Revocation does not cancel an Apple App Store or Google Play subscription.
- The production monitoring job runs every six hours. Admins can also run `creator-monitoring` from the maintenance-jobs API.

## RevenueCat setup

1. Add the secret `REVENUECAT_WEBHOOK_AUTH` in Replit Secrets.
2. Set `CREATOR_PRODUCT_IDS` to the comma-separated RevenueCat product IDs eligible for the creator offer.
3. In RevenueCat, create a webhook for `https://msafirikenya.com/api/webhooks/revenuecat`.
4. Set its Authorization header to exactly the same secret value.
5. Send a RevenueCat test event and verify a row appears in `creator_subscription_events`.
6. Unrelated products and events older than the last applied lifecycle event are stored but ignored.

New applications link the canonical report device ID and RevenueCat app-user ID. Existing legacy applicants are not automatically relinked because doing so without verified ownership would allow attribution takeover.

## Rollout

- Publish applies the additive development schema to production.
- The mobile identity-link change is JavaScript-only and can be delivered through an EAS Update to runtime `2.0.2`.
- Do not enforce inactivity against `pending` or merely `assigned` benefits. The clock starts only for active RevenueCat lifecycle states.