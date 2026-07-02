---
name: react-native-maps Marker tap closes immediately / doesn't register
description: Why a Marker-driven detail modal/sheet flashes open then instantly closes or fails to open at all, and the fixes
---

## Rule (event propagation)
Never attach `onPress` to the `<MapView>` itself to clear/dismiss a selection state that a `Marker`'s own `onPress` sets. Tapping a `Marker` also fires the parent `MapView`'s `onPress` right after (a well-known react-native-maps event-propagation quirk), so a state set by the marker tap gets immediately cleared by the map tap on the same gesture.

**Why:** This produces a "detail panel flashes open then disappears almost instantly" bug — looks like a state/render bug but is actually a duplicate-event issue.

**How to apply:** If you need outside-tap-to-dismiss behavior for a marker-triggered modal/sheet, use a backdrop `TouchableOpacity` (or the equivalent overlay) that closes on press, not a `MapView`-level `onPress`. If only a simple persistent detail view is needed (no custom interactive content), prefer react-native-maps' native `<Callout>` attached directly to the `Marker` — it sidesteps this issue entirely since react-native-maps manages its show/hide internally.

## Rule (custom marker views on Android)
Custom View-based marker content (icon circles, cluster badges, etc. rendered as `children` of `<Marker>`) needs `collapsable={false}` on the outermost `View`. Without it, Android's native view flattening optimization can drop the view from the native hierarchy that receives touch events, making taps land inconsistently — sometimes a marker responds, sometimes the identical-looking one next to it doesn't.

**Why:** Reported symptom was "incident popups not opening correctly when tapped" — intermittent, not 100% reproducible, which is the signature of this Android-only view-flattening issue rather than a JS logic bug.

**How to apply:** Add `collapsable={false}` to the top-level wrapper `View` of any custom marker/cluster component. Also give cluster `<Marker>` a stable `key` derived from sorted member ids (not the array index) — an index-based key causes React to reuse/remount marker instances across re-renders as the underlying list changes order, which can leave stale touch handlers bound to the wrong marker.
