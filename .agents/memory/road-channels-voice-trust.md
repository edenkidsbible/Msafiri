---
name: Road Channels voice-report trust boundary
description: Publication and moderation rules for AI-interpreted driver voice reports.
---

Road Channels audio upload and AI interpretation are private staging steps. Neither step may publish an alert. Only an explicit driver confirmation may create the ordinary community report.

**Why:** Speech transcription and classification can be wrong. Reusing the normal report pipeline after confirmation preserves map visibility, expiry, deduplication, nearby refresh, blocked-device checks, and camera moderation safeguards.

**How to apply:** Any new voice category, channel client, or admin tool must preserve the staged upload → interpretation → confirmation → community-report sequence. Camera voice reports remain pending review before global map visibility.

Voice incident reporting is not limited to supported live Road Channels. During an active drive, a driver with a valid location may create a private community-report draft even when no channel is within range. Only live listening, aggregate presence, and channel-feed publication depend on a supported nearby channel.

**Why:** Useful first-hand incident reports occur on roads that do not yet have a live channel. Treating channel discovery as a microphone gate unnecessarily discards that safety data.

**How to apply:** Keep the microphone available outside channel coverage, skip presence membership for the community-draft path, retain the detected road name and coordinates, and never insert the confirmed report into a channel feed unless it originated from a supported joined channel.