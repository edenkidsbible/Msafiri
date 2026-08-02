/**
 * AdminLocationPickerModal.native.tsx
 * Full-screen map modal that lets an admin fix a report's exact location using
 * the center-crosshair picker: pan the map under the fixed pin, then save.
 * Opened from the report popup (DriveMapView) when admin mode is active.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CrosshairMap } from "./CrosshairPicker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

interface Props {
  visible: boolean;
  reportId: string;
  initialLat: number;
  initialLng: number;
  initialRoadName?: string;
  onClose: () => void;
  /** Called with the new position; should call adminUpdateReportLocation under the hood. */
  onSave: (lat: number, lng: number, roadName?: string) => Promise<void>;
}

export function AdminLocationPickerModal({
  visible,
  reportId: _reportId,
  initialLat,
  initialLng,
  initialRoadName,
  onClose,
  onSave,
}: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { setMapPickerActive } = useApp();

  const [pos, setPos] = useState({ latitude: initialLat, longitude: initialLng });
  const [roadName, setRoadName] = useState(initialRoadName ?? "");
  const [saving, setSaving] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);
  // Gate CrosshairMap mount on onShow — same two-MapView protection as
  // CrosshairPickerModal. mapPickerActive also tells DriveMapView to unmount
  // its own MapView so only one native surface is alive at a time.
  const [mapMounted, setMapMounted] = useState(false);

  const handleShow = () => {
    setPos({ latitude: initialLat, longitude: initialLng });
    setRoadName(initialRoadName ?? "");
    setMapPickerActive(true);
    setMapMounted(true);
  };

  const handleClose = () => {
    setMapMounted(false);
    setMapPickerActive(false);
    onClose();
  };

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setReverseLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "User-Agent": "MsafiriKenyaApp/1.0" } }
      );
      const data = await res.json();
      const road =
        data?.address?.road ??
        data?.address?.street ??
        data?.address?.pedestrian ??
        data?.address?.path ??
        "";
      if (road) setRoadName(road);
    } catch {
      // Silently ignore geocode failures; user can type manually.
    } finally {
      setReverseLoading(false);
    }
  }, []);

  // Debounce reverse-geocoding — onRegionChangeComplete can fire in quick
  // succession while the admin fine-tunes the position.
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCoordinateChange = (latitude: number, longitude: number) => {
    setPos({ latitude, longitude });
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(() => void reverseGeocode(latitude, longitude), 600);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(pos.latitude, pos.longitude, roadName.trim() || undefined);
      handleClose();
      Alert.alert("Location Updated", "The report position has been saved.");
    } catch (err: any) {
      Alert.alert("Save Failed", err?.message ?? "Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      onShow={handleShow}
      onDismiss={() => { setMapMounted(false); setMapPickerActive(false); }}
    >
      <View style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + 10, borderBottomColor: c.border },
          ]}
        >
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: c.background }]}
            onPress={handleClose}
            disabled={saving}
          >
            <Ionicons name="close" size={20} color={c.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Fix Report Location</Text>
          {/* Spacer to keep title centred */}
          <View style={{ width: 36 }} />
        </View>

        {/* Map — gate on mapMounted (set by onShow) so DriveMapView's MapView
            is fully unmounted before this one initialises. */}
        {mapMounted ? (
          <CrosshairMap
            initialLat={initialLat}
            initialLng={initialLng}
            initialDelta={0.005}
            onCoordinateChange={handleCoordinateChange}
          />
        ) : (
          <View style={{ flex: 1, backgroundColor: "#000" }} />
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
          <Text style={[styles.panelLabel, { color: c.mutedForeground }]}>COORDINATES</Text>
          <Text style={[styles.coords, { color: c.foreground }]}>
            {pos.latitude.toFixed(5)},  {pos.longitude.toFixed(5)}
          </Text>

          <Text style={[styles.panelLabel, { color: c.mutedForeground, marginTop: 14 }]}>
            ROAD NAME
          </Text>
          <View style={{ position: "relative" }}>
            <TextInput
              style={[
                styles.roadInput,
                {
                  color: c.foreground,
                  borderColor: c.border,
                  backgroundColor: c.background,
                  paddingRight: reverseLoading ? 40 : 12,
                },
              ]}
              placeholder="Road / street name (optional)"
              placeholderTextColor={c.mutedForeground}
              value={roadName}
              onChangeText={setRoadName}
            />
            {reverseLoading && (
              <ActivityIndicator
                size="small"
                color={c.mutedForeground}
                style={{ position: "absolute", right: 12, top: 0, bottom: 0 }}
              />
            )}
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, { opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.saveTxt}>Save Location</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  panelLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  coords: { fontSize: 14, fontFamily: "Inter_500Medium" },
  roadInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 14,
    minHeight: 50,
    backgroundColor: "#1565C0",
  },
  saveTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#FFF" },
});
