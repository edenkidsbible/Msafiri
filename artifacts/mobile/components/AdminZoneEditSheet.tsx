/**
 * AdminZoneEditSheet — bottom sheet for editing (or creating) a speed zone's
 * metadata: name, road, speed limit, type, and description.
 *
 * Used by admins tapping a zone marker on the map.
 */
import React, { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { SpeedZone } from "@/data/speedZones";

export interface ZoneEditFields {
  name: string;
  road: string;
  speedLimit: number | null;
  type: "camera" | "police" | "zone";
  description: string;
}

interface Props {
  /** When supplied, the sheet is in EDIT mode; otherwise CREATE mode. */
  zone?: SpeedZone;
  /** Coordinates pre-filled for create mode. */
  createCoords?: { lat: number; lng: number };
  visible: boolean;
  onClose: () => void;
  onSave: (fields: ZoneEditFields) => Promise<void>;
}

const ZONE_TYPES: { key: "camera" | "police" | "zone"; label: string; icon: string; color: string }[] = [
  { key: "camera", label: "Camera",  icon: "camera",      color: "#E53935" },
  { key: "police", label: "Police",  icon: "shield",      color: "#1565C0" },
  { key: "zone",   label: "Zone",    icon: "speedometer", color: "#E65100" },
];

export default function AdminZoneEditSheet({ zone, createCoords, visible, onClose, onSave }: Props) {
  const c = useColors();
  const isDark = c.isDark;

  const [name,        setName]        = useState("");
  const [road,        setRoad]        = useState("");
  const [speedLimit,  setSpeedLimit]  = useState("");
  const [type,        setType]        = useState<"camera" | "police" | "zone">("camera");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset fields whenever the target zone or visibility changes
  useEffect(() => {
    if (!visible) return;
    setName(zone?.name        ?? "");
    setRoad(zone?.road        ?? "");
    setSpeedLimit(zone?.speedLimit != null ? String(zone.speedLimit) : "");
    setType((zone?.type as "camera" | "police" | "zone") ?? "camera");
    setDescription(zone?.description ?? "");
  }, [visible, zone]);

  const bg       = isDark ? "#1C1C1E" : "#FFFFFF";
  const fg       = isDark ? "#FFFFFF" : "#1A1A1A";
  const fgMuted  = isDark ? "#999"    : "#757575";
  const inputBg  = isDark ? "#2C2C2E" : "#F5F5F5";
  const divider  = isDark ? "#333"    : "#E0E0E0";

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert("Missing field", "Zone name is required.");
      return;
    }
    const sl = speedLimit.trim() ? parseInt(speedLimit.trim(), 10) : null;
    if (speedLimit.trim() && (isNaN(sl!) || sl! <= 0)) {
      Alert.alert("Invalid speed limit", "Enter a positive number or leave blank.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), road: road.trim(), speedLimit: sl, type, description: description.trim() });
      onClose();
    } catch (err: unknown) {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const isCreate = !zone;
  const title    = isCreate ? "Add New Zone" : "Edit Zone";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[ss.sheet, { backgroundColor: bg }]}
        >
          {/* Handle */}
          <View style={[ss.handle, { backgroundColor: fgMuted + "55" }]} />

          {/* Header */}
          <View style={ss.header}>
            <View style={[ss.adminChip, { backgroundColor: "#1565C015", borderColor: "#1565C040" }]}>
              <Ionicons name="shield" size={12} color="#1565C0" />
              <Text style={[ss.adminChipTxt, { color: "#1565C0" }]}>ADMIN</Text>
            </View>
            <Text style={[ss.title, { color: fg }]}>{title}</Text>
            {createCoords && (
              <Text style={[ss.coordsTxt, { color: fgMuted }]}>
                {createCoords.lat.toFixed(5)}, {createCoords.lng.toFixed(5)}
              </Text>
            )}
            <TouchableOpacity style={ss.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={fgMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Type selector */}
            <Text style={[ss.label, { color: fgMuted }]}>TYPE</Text>
            <View style={ss.typeRow}>
              {ZONE_TYPES.map((t) => {
                const active = type === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[ss.typeBtn, {
                      backgroundColor: active ? t.color + "18" : inputBg,
                      borderColor:     active ? t.color         : divider,
                      borderWidth:     active ? 1.5             : 1,
                    }]}
                    onPress={() => setType(t.key)}
                  >
                    <Ionicons name={t.icon as any} size={16} color={active ? t.color : fgMuted} />
                    <Text style={[ss.typeTxt, { color: active ? t.color : fgMuted }]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Name */}
            <Text style={[ss.label, { color: fgMuted }]}>NAME *</Text>
            <TextInput
              style={[ss.input, { backgroundColor: inputBg, color: fg, borderColor: divider }]}
              placeholder="e.g. Thika Road Camera"
              placeholderTextColor={fgMuted}
              value={name}
              onChangeText={setName}
              returnKeyType="next"
            />

            {/* Road */}
            <Text style={[ss.label, { color: fgMuted }]}>ROAD</Text>
            <TextInput
              style={[ss.input, { backgroundColor: inputBg, color: fg, borderColor: divider }]}
              placeholder="e.g. A2 — Thika Road"
              placeholderTextColor={fgMuted}
              value={road}
              onChangeText={setRoad}
              returnKeyType="next"
            />

            {/* Speed limit */}
            <Text style={[ss.label, { color: fgMuted }]}>SPEED LIMIT (km/h)</Text>
            <TextInput
              style={[ss.input, { backgroundColor: inputBg, color: fg, borderColor: divider }]}
              placeholder="e.g. 80  (leave blank if unknown)"
              placeholderTextColor={fgMuted}
              value={speedLimit}
              onChangeText={setSpeedLimit}
              keyboardType="number-pad"
              returnKeyType="next"
            />

            {/* Description */}
            <Text style={[ss.label, { color: fgMuted }]}>DESCRIPTION</Text>
            <TextInput
              style={[ss.input, ss.inputMulti, { backgroundColor: inputBg, color: fg, borderColor: divider }]}
              placeholder="Optional notes visible to admins"
              placeholderTextColor={fgMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />

            {/* Save */}
            <TouchableOpacity
              style={[ss.saveBtn, { backgroundColor: "#1565C0", opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#FFF" size="small" />
                : <>
                    <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                    <Text style={ss.saveTxt}>{isCreate ? "Create Zone" : "Save Changes"}</Text>
                  </>}
            </TouchableOpacity>

            <View style={{ height: 28 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  backdrop:    { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000060" },
  sheet:       { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingTop: 12, maxHeight: "90%" },
  handle:      { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  header:      { marginBottom: 16 },
  adminChip:   { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  adminChipTxt:{ fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  title:       { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 2 },
  coordsTxt:   { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 2 },
  closeBtn:    { position: "absolute", top: 0, right: 0, padding: 4 },
  label:       { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 6, marginTop: 14 },
  typeRow:     { flexDirection: "row", gap: 8 },
  typeBtn:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  typeTxt:     { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  input:       { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  inputMulti:  { height: 80, textAlignVertical: "top" },
  saveBtn:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14, marginTop: 20 },
  saveTxt:     { color: "#FFF", fontSize: 16, fontFamily: "Inter_700Bold" },
});
