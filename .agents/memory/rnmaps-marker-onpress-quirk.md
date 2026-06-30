---
name: react-native-maps Marker tap closes immediately
description: Why a Marker-driven detail modal/sheet flashes open then instantly closes, and the fix
---

## Rule
Never attach `onPress` to the `<MapView>` itself to clear/dismiss a selection state that a `Marker`'s own `onPress` sets. Tapping a `Marker` also fires the parent `MapView`'s `onPress` right after (a well-known react-native-maps event-propagation quirk), so a state set by the marker tap gets immediately cleared by the map tap on the same gesture.

**Why:** This produces a "detail panel flashes open then disappears almost instantly" bug — looks like a state/render bug but is actually a duplicate-event issue.

**How to apply:** If you need outside-tap-to-dismiss behavior for a marker-triggered modal/sheet, use a backdrop `TouchableOpacity` (or the equivalent overlay) that closes on press, not a `MapView`-level `onPress`. If only a simple persistent detail view is needed (no custom interactive content), prefer react-native-maps' native `<Callout>` attached directly to the `Marker` — it sidesteps this issue entirely since react-native-maps manages its show/hide internally.
