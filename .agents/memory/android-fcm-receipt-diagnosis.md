---
name: Android FCM receipt diagnosis
description: How to distinguish an accepted Expo ticket from real Android delivery and repair Firebase credential failures.
---

An Expo push ticket with `status: ok` only confirms that Expo accepted the request. Android delivery must be verified from the later Expo push receipt.

**Why:** A production Android test token can register normally and receive an accepted Expo ticket while the receipt returns `DeveloperError` / “Failed to authenticate with the FCM server.” In that case the app, notification channel, and token are not the root cause.

**How to apply:** For Android delivery failures, send one controlled device test and inspect its receipt. If it reports FCM authentication, replace the Expo project's **FCM V1 service-account JSON** with a key from the matching Firebase project. `google-services.json` is a separate client registration file and does not replace the FCM V1 service-account credential. Do not retest remote push in Expo Go; use an EAS Android build.