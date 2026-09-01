---
name: Hybrid store and drive-count trial
description: The subscription trial combines a store-controlled three-day window with a maximum of three qualifying drives.
---

## Core rule

Premium access requires starting the App Store or Google Play subscription. Its introductory offer is a three-day free trial, and that active trial includes at most three qualifying drives. Non-subscribers do not receive separate free-drive access.

**Why:** The timed trial creates a clear subscription conversion path, while the drive cap prevents unlimited usage during the free period and guarantees each consumed session reflects meaningful product use.

**How to apply:** Use RevenueCat/store metadata as the source of truth for trial eligibility and duration. Apply the drive-count restriction only while the entitlement period type is `TRIAL`; once it renews as paid, driving is unlimited.

## Quality gate for included trial drives

A drive counts toward the 3-session free trial only if:
- Wall-clock duration ≥ 5 minutes, OR
- Distance ≥ 2 km

Gate applied at two points in drive.tsx:
1. `captureAndStop` — computes `trialDrivesRemaining` optimistically using `sessionsUsedRef.current + 1`; passes it into `TripSummaryData`
2. End-trip effect — gates `recordTrialSession(deviceId)` call behind the same condition

The 50 m minimum for saving a server session is separate and unchanged.

## In-drive "Trial Drive X of 3" pill

Absolutely positioned at `top: topInset + 8`, centered horizontally. Only shown when:
- `tripActive && isOnTrial && !trialExpired && primaryAlert == null && !isOffline && Platform.OS !== "web"`

Text: `Trial Drive {sessionsUsed + 1} of {FREE_TRIAL_SESSIONS}`
- `sessionsUsed` from `useTrialSessions()`, also held in `sessionsUsedRef` for closure stability in `captureAndStop`

## TripSummaryModal trial banner

`TripSummaryData.trialDrivesRemaining?: number | null` — added field:
- `null` = not applicable (subscribed or drive too short)
- `1` or `2` = green banner "X free drives remaining"
- `0` = orange banner "Your 3 free drives are complete 🎉" + subscribe prompt

Banner appears between header and score section.

## Paywall trial language

Show “3-day free trial,” “No charge today,” and the trial CTA only when RevenueCat returns a zero-price introductory offer and the store confirms eligibility. Always disclose the three-drive maximum and regular renewal price. Ineligible users see normal subscription copy.

## Post-trial push nudge sequence (server-side)

`sendTrialExpiredNudges()` in pushNotifications.ts runs every 30-min cron cycle.

Schema additions to `device_trial_sessions`:
- `device_id TEXT` — nullable, linked to `push_tokens.device_id` for notification targeting
- `trial_expired_at TIMESTAMPTZ` — stamped when `session_count` first reaches `FREE_TRIAL_SESSIONS`
- `nudge_stage INTEGER DEFAULT 0` — 0=none, 1=30min sent, 2=24h sent, 3=done

Stage windows:
| Stage | Time range after expiry | Message |
|-------|------------------------|---------|
| 0→1   | 30–120 min             | "Your free drives are complete 🎉" |
| 1→2   | 20–30 hours            | "Driving today?" |
| 2→3   | 2–5 days               | "Your Msafiri offer is still waiting" |

`device_id` is passed from mobile on every `POST /trial/session` call (upserted via COALESCE so first non-null value is kept). If no token found for a device, nudge_stage is advanced anyway to avoid infinite retries.

## Review prompt timing

Changed from after 5th drive → after 2nd drive (drive.tsx `completedSessionCount >= 2`). Rationale: paywall hits after 3rd drive, review must fire before the gate.

## `recordTrialSession(deviceId?)` signature

Updated to accept optional `deviceId` string, forwarded in POST body. Offline fallback still works (no deviceId sent in that path).

**Why:** These changes collectively implement the "3 Drives on Us" funnel described in the product notes — awareness building during the drive, value reinforcement after, and a re-engagement nudge sequence for users who hit the limit but don't subscribe immediately.
