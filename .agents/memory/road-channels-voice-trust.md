---
name: Road Channels voice-report trust boundary
description: Publication and moderation rules for AI-interpreted driver voice reports.
---

Road Channels audio upload and AI interpretation are private staging steps. Neither step may publish an alert. Only an explicit driver confirmation may create the ordinary community report.

**Why:** Speech transcription and classification can be wrong. Reusing the normal report pipeline after confirmation preserves map visibility, expiry, deduplication, nearby refresh, blocked-device checks, and camera moderation safeguards.

**How to apply:** Any new voice category, channel client, or admin tool must preserve the staged upload → interpretation → confirmation → community-report sequence. Camera voice reports remain pending review before global map visibility.