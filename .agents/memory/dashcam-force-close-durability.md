---
name: Dashcam force-close durability
description: Persistence ordering and recovery rules that keep recent completed dashcam clips visible after interruption or process termination.
---

Completed dashcam segments must move into durable document storage, then synchronously commit the replacement metadata index before any older file is deleted. Never rely only on a React state persistence effect for this boundary.

**Why:** A force-close can occur after a completed MP4 reaches durable storage but before a deferred metadata effect runs. The file then survives but disappears from the Clips page; deleting the old rolling entry before committing the replacement can also leave fewer than five visible clips.

**How to apply:** Treat file move + awaited index commit as the save transaction, delete evicted files only afterward, and reconcile unindexed segment MP4s from the vehicle’s document directory during hydration. AppState protection must work on Android and iOS; debounce transient `inactive` events but finish the segment for sustained interruptions. A still-active CameraView recording has no recoverable URI until the native API finalizes it, so guarantees apply to completed/finalized segments.