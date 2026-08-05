/**
 * AdminReportEditSheet — bottom sheet for editing a community report's
 * type and road name. Only shown when isAdmin is true.
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
import { INCIDENT_TYPE_ORDER, resolveIncidentType } from "@/constants/incidentTypes";
import type { CommunityReport } from "@/context/AppContext";

interface Props {
  report: CommunityReport;
  visible: boolean;
  onClose: () => void;
  onSave: (fields: { type: string; roadName: string | null }) => Promise<void>;
}

// Types that an admin can assign (excludes internal __unknown)
const SELECTABLE_TYPES = INCIDENT_TYPE_ORDER.filter((t) => t !== "zone");

export default function AdminReportEditSheet({ report, visible, onClose, onSave }: Props) {
  const c      = useColors();
  const isDark = c.isDark;

  const [type,     setType]     = useState(report.type as string);
  const [roadName, setRoadName] = useState(report.roadName ?? "");
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (!visible) return;
    setType(report.type as string);
    setRoadName(report.roadName ?? "");
  }, [visible, report]);

  const bg      = isDark ? "#1C1C1E" : "#FFFFFF";
  const fg      = isDark ? "#FFFFFF" : "#1A1A1A";
  const fgMuted = isDark ? "#999"    : "#757575";
  const inputBg = isDark ? "#2C2C2E" : "#F5F5F5";
  const divider = isDark ? "#333"    : "#E0E0E0";

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ type, roadName: roadName.trim() || null });
      onClose();
    } catch (err: unknown) {
      Alert.alert("Save failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ss.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[ss.sheet, { backgroundColor: bg }]}
        >
          <View style={[ss.handle, { backgroundColor: fgMuted + "55" }]} />

          {/* Header */}
          <View style={ss.header}>
            <View style={[ss.adminChip, { backgroundColor: "#1565C015", borderColor: "#1565C040" }]}>
              <Ionicons name="shield" size={12} color="#1565C0" />
              <Text style={[ss.adminChipTxt, { color: "#1565C0" }]}>ADMIN</Text>
            </View>
            <Text style={[ss.title, { color: fg }]}>Edit Report</Text>
            <TouchableOpacity style={ss.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={fgMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Type grid */}
            <Text style={[ss.label, { color: fgMuted }]}>INCIDENT TYPE</Text>
            <View style={ss.typeGrid}>
              {SELECTABLE_TYPES.map((key) => {
                const def    = resolveIncidentType(key);
                const active = type === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[ss.typeCell, {
                      backgroundColor: active ? def.color + "18" : inputBg,
                      borderColor:     active ? def.color         : divider,
                      borderWidth:     active ? 1.5               : 1,
                    }]}
                    onPress={() => setType(key)}
                  >
                    <Text style={ss.typeEmoji}>{def.emoji}</Text>
                    <Text style={[ss.typeCellTxt, { color: active ? def.color : fgMuted }]} numberOfLines={1}>
                      {def.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Road name */}
            <Text style={[ss.label, { color: fgMuted }]}>ROAD NAME</Text>
            <TextInput
              style={[ss.input, { backgroundColor: inputBg, color: fg, borderColor: divider }]}
              placeholder="e.g. A2 — Thika Road  (leave blank to clear)"
              placeholderTextColor={fgMuted}
              value={roadName}
              onChangeText={setRoadName}
              returnKeyType="done"
            />

            <TouchableOpacity
              style={[ss.saveBtn, { backgroundColor: "#1565C0", opacity: saving ? 0.6 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#FFF" size="small" />
                : <>
                    <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                    <Text style={ss.saveTxt}>Save Changes</Text>
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
  backdrop:     { flex: 1, justifyContent: "flex-end", backgroundColor: "#00000060" },
  sheet:        { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingTop: 12, maxHeight: "88%" },
  handle:       { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  header:       { marginBottom: 16 },
  adminChip:    { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  adminChipTxt: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  title:        { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 2 },
  closeBtn:     { position: "absolute", top: 0, right: 0, padding: 4 },
  label:        { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.6, marginBottom: 8, marginTop: 14 },
  typeGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeCell:     { width: "30%", flexGrow: 1, alignItems: "center", gap: 4, paddingVertical: 10, borderRadius: 10 },
  typeEmoji:    { fontSize: 20 },
  typeCellTxt:  { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  input:        { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular" },
  saveBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, borderRadius: 14, marginTop: 20 },
  saveTxt:      { color: "#FFF", fontSize: 16, fontFamily: "Inter_700Bold" },
});
