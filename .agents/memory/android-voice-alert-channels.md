---
name: Android voice alert channels
description: Durable rule for shipping reliable Yna Agalo notification-channel sounds on existing Android installs.
---

Android notification-channel sound and importance settings are immutable after the OS first creates a channel. Per-type Yna Agalo channels must use versioned IDs, and the version must change whenever packaged sounds or channel sound configuration changes.

**Why:** Reusing an existing channel ID preserves its original sound configuration across app updates. If the channel was first created while a sound was missing or invalid, later builds cannot repair it and background or locked-phone alerts remain silent.

**How to apply:** Resolve background alerts to the latest versioned per-type channel IDs. During setup, validate the actual voice channels for existence, high importance, and a configured sound rather than validating only the generic fallback channel.