import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { CommunityReport } from "@/context/AppContext";

type ReportType = CommunityReport["type"];

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (type: ReportType, speedLimit?: number) => void;
}

const TYPES: Array<{
  type: ReportType;
  label: string;
  emoji: string;
  color: string;
}> = [
  { type: "camera",    label: "Speed Camera",  emoji: "📷",  color: "#E53935" },
  { type: "police",    label: "Police Check",   emoji: "🚔",  color: "#1565C0" },
  { type: "accident",  label: "Accident",       emoji: "💥",  color: "#B71C1C" },
  { type: "traffic",   label: "Traffic Jam",    emoji: "🚦",  color: "#C62828" },
  { type: "roadblock", label: "Roadblock",      emoji: "🚧",  color: "#7B1FA2" },
  { type: "hazard",    label: "Hazard",         emoji: "⚠️",  color: "#FF6F00" },
  { type: "pothole",   label: "Pothole",        emoji: "🕳️",  color: "#F57C00" },
  { type: "debris",    label: "Debris",         emoji: "🪨",  color: "#795548" },
  { type: "breakdown", label: "Broken Down",    emoji: "🚗",  color: "#FF8F00" },
  { type: "weather",   label: "Bad Weather",    emoji: "🌧️",  color: "#37474F" },
  { type: "closure",   label: "Road Closed",    emoji: "🛑",  color: "#880E4F" },
  { type: "clear",     label: "Road Clear",     emoji: "✅",  color: "#00C853" },
];

export default function ReportModal({ visible, onClose, onSubmit }: ReportModalProps) {
  const c = useColors();
  const [sel, setSel] = useState<ReportType | null>(null);
  const [speedLimit, setSpeedLimit] = useState("");
  const selItem = TYPES.find((t) => t.type === sel);

  const reset = () => {
    setSel(null);
    setSpeedLimit("");
  };

  const submit = () => {
    if (!sel) return;
    const limit = sel === "camera" && speedLimit.trim()
      ? parseInt(speedLimit.trim(), 10)
      : undefined;
    onSubmit(sel, isNaN(limit as number) ? undefined : limit);
    reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <Text style={[styles.title, { color: c.foreground }]}>Report an Incident</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            What do you see at your current location?
          </Text>

          {/* Type grid */}
          <View style={styles.grid}>
            {TYPES.map((t) => {
              const active = sel === t.type;
              return (
                <TouchableOpacity
                  key={t.type}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? t.color + "18" : c.muted,
                      borderColor: active ? t.color : c.border,
                    },
                  ]}
                  onPress={() => { setSel(t.type); setSpeedLimit(""); }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.chipIconWrap, { backgroundColor: t.color + (active ? "30" : "18") }]}>
                    <Text style={styles.chipEmoji}>{t.emoji}</Text>
                  </View>
                  <Text
                    style={[
                      styles.chipLabel,
                      { color: active ? t.color : c.foreground },
                      active && { fontFamily: "Inter_600SemiBold" },
                    ]}
                    numberOfLines={1}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Speed limit field — appears when "Speed Camera" is selected */}
          {sel === "camera" && (
            <View style={[styles.speedRow, { backgroundColor: "#E5393512", borderColor: "#E5393544" }]}>
              <Ionicons name="speedometer-outline" size={18} color="#E53935" />
              <Text style={[styles.speedLabel, { color: "#E53935" }]}>Speed limit at this camera:</Text>
              <View style={[styles.speedInputWrap, { borderColor: "#E5393566", backgroundColor: c.card }]}>
                <TextInput
                  style={[styles.speedInput, { color: c.foreground }]}
                  value={speedLimit}
                  onChangeText={(v) => setSpeedLimit(v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="km/h"
                  placeholderTextColor={c.mutedForeground}
                  maxLength={3}
                  returnKeyType="done"
                />
              </View>
              <Text style={[styles.speedOptional, { color: c.mutedForeground }]}>optional</Text>
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: c.border }]}
              onPress={handleClose}
            >
              <Text style={[styles.cancelTxt, { color: c.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: sel ? (selItem?.color ?? c.primary) : c.muted }]}
              onPress={submit}
              disabled={!sel}
            >
              {selItem && <Text style={styles.submitEmoji}>{selItem.emoji}</Text>}
              <Text style={[styles.submitTxt, { color: sel ? "#FFF" : c.mutedForeground }]}>
                {selItem ? `Report ${selItem.label}` : "Select one above"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 48 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    borderRadius: 12, borderWidth: 1.5, width: "47%",
  },
  chipIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chipLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1 },

  speedRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 11,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  speedLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  speedInputWrap: {
    borderWidth: 1.5, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
    minWidth: 68,
  },
  speedInput: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center", minWidth: 52 },
  speedOptional: { fontSize: 11, fontFamily: "Inter_400Regular" },

  chipEmoji: { fontSize: 17, lineHeight: 22 },
  submitEmoji: { fontSize: 16, lineHeight: 20 },

  actions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 0.4, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: "center" },
  cancelTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  submitBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
  },
  submitTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
