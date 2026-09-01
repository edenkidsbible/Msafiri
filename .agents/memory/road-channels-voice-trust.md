---
name: Road Channels voice-report trust boundary
description: Publication and moderation rules for AI-interpreted driver voice reports.
---

Road Channels audio upload and AI interpretation are private staging steps. Neither step may publish an alert. Only an explicit driver confirmation may create the ordinary community report.

**Why:** Speech transcription and classification can be wrong. Reusing the normal report pipeline after confirmation preserves map visibility, expiry, deduplication, nearby refresh, blocked-device checks, and camera moderation safeguards.

**How to apply:** Any new voice category, channel client, or admin tool must preserve the staged upload → interpretation → confirmation → community-report sequence. Camera voice reports remain pending review before global map visibility.

The driver's explicit report-category selection is authoritative. Audio remains private report content for playback and moderation; speech recognition must not classify the report or determine whether it can proceed.

**Why:** Short, accented, noisy, or silent recordings made speech classification unreliable and produced avoidable “could not interpret” failures even when the driver already knew what they were reporting.

**How to apply:** Require a valid category before enabling recording, send it with draft preparation and confirmation, map it server-side to an allowed community-report type, and reject missing, unsupported, or changed categories.

Voice incident reporting is not limited to supported live Road Channels. During an active drive, a driver with a valid location may create a private community-report draft even when no channel is within range. Only live listening, aggregate presence, and channel-feed publication depend on a supported nearby channel.

**Why:** Useful first-hand incident reports occur on roads that do not yet have a live channel. Treating channel discovery as a microphone gate unnecessarily discards that safety data.

**How to apply:** Keep the microphone available outside channel coverage, skip presence membership for the community-draft path, retain the detected road name and coordinates, and never insert the confirmed report into a channel feed unless it originated from a supported joined channel.

Resolve and pin the report location when recording starts: use the live fix when present, otherwise request a fresh high-accuracy fix and fall back only to a recent cached OS fix. Reuse that pinned location through upload and confirmation.

**Why:** The shared live-location prop can briefly be null while GPS subscriptions start or recover. Rejecting the mic at that moment makes automatic location feel manual; using a later moving fix can attach the report to the wrong point.

**How to apply:** The voice control owns tap-time location recovery. Clear the pinned fix only after confirmation, cancellation, or re-recording.