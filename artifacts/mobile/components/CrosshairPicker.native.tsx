/**
 * CrosshairPicker.native.tsx
 * Center-crosshair map location picker — the industry-standard replacement for
 * draggable Markers. A static pin is rendered as a plain overlay View at the
 * map's center; the user pans the map underneath it and the selected coordinate
 * is read from onRegionChangeComplete. No draggable Marker, no gesture
 * conflicts, no crash surface.
 *
 * Exports:
 *  - CrosshairMap: the core (non-modal) map + fixed center pin. Fills its
 *    container. Never place inside a ScrollView — use full-screen.
 *  - CrosshairPickerModal: full-screen modal wrapper with confirm/cancel,
 *    used by the report flow.
 */
import React, { useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

export interface CrosshairMapProps {
  initialLat: number;
  initialLng: number;
  /** Fired on every onRegionChangeComplete with the map-center coordinate. */
  onCoordinateChange: (lat: number, lng: number) => void;
  /** Initial zoom span (defaults to a ~400 m street-level view). */
  initialDelta?: number;
  pinColor?: string;
}

/**
 * Core crosshair map. The pin "lifts" while the map is moving (onRegionChange)
 * and "settles" when it comes to rest (onRegionChangeComplete) so the
 * interaction feels intentional.
 */
export function CrosshairMap({
  initialLat,
  initialLng,
  onCoordinateChange,
  initialDelta = 0.004,
  pinColor = "#E53935",
}: CrosshairMapProps) {
  const lift = useRef(new Animated.Value(0)).current;
  const liftedRef = useRef(false);

  const setLifted = (up: boolean) => {
    if (liftedRef.current === up) return;
    liftedRef.current = up;
    Animated.spring(lift, {
      toValue: up ? 1 : 0,
      useNativeDriver: true,
      speed: 24,
      bounciness: up ? 4 : 9,
    }).start();
  };

  return (
    <View style={styles.mapWrap}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: initialLat,
          longitude: initialLng,
          latitudeDelta: initialDelta,
          longitudeDelta: initialDelta,
        }}
        onRegionChange={() => setLifted(true)}
        onRegionChangeComplete={(region: { latitude: number; longitude: number } | undefined) => {
          setLifted(false);
          // Guard: region can theoretically be undefined on some map controls.
          if (!region || typeof region.latitude !== "number") return;
          onCoordinateChange(region.latitude, region.longitude);
        }}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      />

      {/* Fixed center pin overlay — plain Views, never a Marker. pointerEvents
          "none" lets all gestures pass through to the map. */}
      <View style={styles.pinOverlay} pointerEvents="none">
        {/* Ground target dot — stays put while the pin lifts */}
        <Animated.View
          style={[
            styles.groundDot,
            {
              opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
              transform: [
                { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              ],
            },
          ]}
        />
        {/* Pin — anchored so its tip sits exactly at the map center */}
        <Animated.View
          style={[
            styles.pinAnchor,
            {
              transform: [
                { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -12] }) },
              ],
            },
          ]}
        >
          <Ionicons name="location" size={44} color={pinColor} style={styles.pinIcon} />
        </Animated.View>
      </View>
    </View>
  );
}

export interface CrosshairPickerModalProps {
  visible: boolean;
  initialLat: number;
  initialLng: number;
  title?: string;
  /** Optional hint line shown above the confirm button. */
  hint?: string;
  onCancel: () => void;
  onConfirm: (lat: number, lng: number) => void;
}

/** Full-screen modal crosshair picker with confirm/cancel actions. */
export function CrosshairPickerModal({
  visible,
  initialLat,
  initialLng,
  title = "Set Location",
  hint,
  onCancel,
  onConfirm,
}: CrosshairPickerModalProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { setMapPickerActive } = useApp();
  const [pos, setPos] = useState({ lat: initialLat, lng: initialLng });
  // Delay MapView mount until the slide animation completes (onShow).
  // Combined with setMapPickerActive(true), this ensures DriveMapView's MapView
  // is unmounted before this one mounts — one native map surface at a time.
  const [mapMounted, setMapMounted] = useState(false);

  const handleClose = (cb: () => void) => {
    setMapMounted(false);
    setMapPickerActive(false);
    cb();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => handleClose(onCancel)}
      onShow={() => {
        setMapPickerActive(true);
        setPos({ lat: initialLat, lng: initialLng });
        setMapMounted(true);
      }}
      onDismiss={() => { setMapMounted(false); setMapPickerActive(false); }}
    >
      <View style={[styles.screen, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: c.border }]}>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: c.background }]}
            onPress={() => handleClose(onCancel)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={20} color={c.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>{title}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Mount the MapView only after onShow fires so we never have two
            concurrent MapViews alive at the same time (the underlying screen's
            map is still mounted while this modal slides in). */}
        {mapMounted ? (
          <CrosshairMap
            initialLat={initialLat}
            initialLng={initialLng}
            onCoordinateChange={(lat, lng) => setPos({ lat, lng })}
          />
        ) : (
          <View style={[styles.mapWrap, { backgroundColor: "#000" }]} />
        )}

        {/* Bottom panel */}
        <View
          style={[
            styles.panel,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
            },
          ]}
        >
          <View style={styles.hintRow}>
            <Ionicons name="move-outline" size={13} color={c.mutedForeground} />
            <Text style={[styles.hintTxt, { color: c.mutedForeground }]}>
              {hint ?? "Pan and zoom the map to place the pin on the exact spot"}
            </Text>
          </View>
          <Text style={[styles.coords, { color: c.foreground }]}>
            {pos.lat.toFixed(5)},  {pos.lng.toFixed(5)}
          </Text>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={() => handleClose(() => onConfirm(pos.lat, pos.lng))}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle" size={18} color="#FFF" />
            <Text style={styles.confirmTxt}>Confirm Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  mapWrap: { flex: 1 },
  pinOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  groundDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  pinAnchor: {
    position: "absolute",
    // Icon is 44px; the glyph's tip sits near the bottom of the box, so shift
    // up half the height (minus a small optical correction) to anchor the tip
    // at the exact map center.
    marginBottom: 40,
    alignItems: "center",
  },
  pinIcon: {
    textShadowColor: "rgba(0,0,0,0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  panel: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  hintTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  coords: { fontSize: 14, fontFamily: "Inter_500Medium" },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 12,
    minHeight: 50,
    backgroundColor: "#1565C0",
  },
  confirmTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
});
