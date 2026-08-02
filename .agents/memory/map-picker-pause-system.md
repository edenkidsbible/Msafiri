---
name: Map picker pause system
description: How the app prevents two-concurrent-MapView native crashes when any full-screen map picker opens.
---

# Map picker pause system

## The rule
`mapPickerActive` (boolean in AppContext) must be `true` for the entire lifetime
of any full-screen map picker modal. Any screen that owns a `MapView` must
unmount (render a `<View>` placeholder) while `mapPickerActive` is true.

## Why
`react-native-maps` allocates a single native map surface. Two concurrent
instances (e.g. DriveMapView + CrosshairPickerModal) contend for the same native
renderer and bridge event queue. The loser goes black. Pan/drag gestures make
this dramatically worse because they fire high-frequency bridge events.

A secondary problem: `CrosshairPickerModal` was nested inside `ReportModal`
(Modal-inside-Modal). iOS requires the presenting VC to be fully settled before
hosting a child; if the user tapped fast the inner modal silently never presented.

## How to apply
**Opening a picker:** Set `setMapPickerActive(true)` inside `onShow` (not on
`visible=true`) so DriveMapView gets the flag before this modal's MapView mounts.

**Closing a picker:** Set `setMapPickerActive(false)` in ALL close paths:
`onRequestClose`, `onDismiss`, cancel button, confirm button. Use a shared
`handleClose()` helper to avoid missing a path.

**MapView gate:** `{mapPickerActive ? <View style={StyleSheet.absoluteFill} /> : <MapView ...>}`

**Nesting rule:** `CrosshairPickerModal` must NEVER be rendered inside another
`Modal`. It lives at the screen root (index.tsx, MapViewScreen.native.tsx). The
parent passes an `onOpenMapPicker(lat, lng, onConfirm)` callback; the screen
holds the `crosshairRequest` state and renders the modal at the top level.

## Files that implement this
- `context/AppContext.tsx` — `mapPickerActive`, `setMapPickerActive`
- `components/DriveMapView.native.tsx` — gates its MapView
- `components/MapViewScreen.native.tsx` — gates its MapView + has own `CrosshairPickerModal` instance
- `components/CrosshairPicker.native.tsx` — calls `setMapPickerActive` in show/close
- `components/AdminLocationPickerModal.native.tsx` — calls `setMapPickerActive` + `mapMounted` gate
- `components/SavedPlaceMapPicker.native.tsx` — `useEffect` sets active on mount, clears on unmount
- `components/ReportModal.tsx` — no longer renders `CrosshairPickerModal`; uses `onOpenMapPicker` callback
- `app/(tabs)/index.tsx` — hosts `CrosshairPickerModal` at screen root
