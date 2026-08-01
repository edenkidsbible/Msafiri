---
name: Crosshair map picker pattern
description: Why draggable Markers were removed and how location picking works now
---
Draggable react-native-maps Markers and MapViews inside ScrollViews crashed natively despite mitigations (tracksViewChanges toggling, parent scroll disabling). Replaced with a fixed center-crosshair picker: static pin overlay View at map center, coordinate read from `onRegionChangeComplete`, lift/settle animation via `onRegionChange`/`onRegionChangeComplete`.

**Why:** removes the crash surface (Marker drag + gesture conflict) instead of guarding it.

**How to apply:** any new location-picking UI in the mobile app must use `components/CrosshairPicker` (`CrosshairMap` core or `CrosshairPickerModal` full-screen wrapper) — never a `draggable` Marker, and never a MapView inside a ScrollView. As of Aug 2026 `SavedPlaceMapPicker.native.tsx` still uses the old draggable pattern (follow-up proposed).
