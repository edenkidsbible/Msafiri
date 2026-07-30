/**
 * AdminLocationPickerModal.native.tsx
 * Full-screen map modal that lets an admin drag-pin to fix a report's exact location.
 * Opened from the report popup (DriveMapView) when admin mode is active.
 */
import React, { useCallback, useState } from "react";
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
import { Platform } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

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

  const [pos, setPos] = useState({ latitude: initialLat, longitude: initialLng });
  const [roadName, setRoadName] = useState(initialRoadName ?? "");
  const [saving, setSaving] = useState(false);
  const [reverseLoading, setReverseLoading] = useState(false);

  // Reset state when modal opens with new coordinates.
  const handleShow = () => {
    setPos({ latitude: initialLat, longitude: initialLng });
    setRoadName(initialRoadName ?? "");
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

  const handlePress = (latitude: number, longitude: number) => {
    setPos({ latitude, longitude });
    void reverseGeocode(latitude, longitude);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(pos.latitude, pos.longitude, roadName.trim() || undefined);
      onClose();
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
      onRequestClose={onClose}
      onShow={handleShow}
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
            onPress={onClose}
            disabled={saving}
          >
            <Ionicons name="close" size={20} color={c.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: c.foreground }]}>Fix Report Location</Text>
          {/* Spacer to keep title centred */}
          <View style={{ width: 36 }} />
        </View>

        {/* Map */}
        <MapView
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          style={styles.map}
          initialRegion={{
            latitude: initialLat,
            longitude: initialLng,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }}
          onPress={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) =>
            handlePress(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)
          }
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <Marker
            coordinate={pos}
            draggable
            onDragEnd={(e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) =>
              handlePress(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)
            }
          />
        </MapView>

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
  map: { flex: 1 },
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
