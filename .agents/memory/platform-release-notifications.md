---
name: Platform-specific release notifications
description: Update releases must target only the matching iOS or Android push tokens, including scheduled publication.
---

Platform-specific app releases must always filter push-token recipients by the release platform. A release marked `ios` must never notify Android devices, and vice versa. The intentionally broad `all` setting is legacy-compatible only.

**Why:** Version checks are platform-aware, but an unfiltered release broadcast previously notified every registered device even when only one store binary was updated.

**How to apply:** Keep immediate publishing and scheduled release promotion on the same notification path. New releases should require an explicit iOS or Android target; retain combined releases only to manage historical records or a deliberate cross-platform broadcast. On app startup, refresh a cached Expo token's platform registration even when GPS has not produced a first fix; the API should preserve its last known location.