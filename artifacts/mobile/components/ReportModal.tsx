import React, { useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { CommunityReport } from "@/context/AppContext";

type ReportType = CommunityReport["type"];

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (type: ReportType) => void;
}

const TYPES: Array<{ type: ReportType; label: string; emoji: string; color: string }> = [
  { type: "camera",    label: "Speed Camera", emoji: "📷", color: "#E53935" },
  { type: "police",    label: "Police Check",  emoji: "🚔", color: "#1565C0" },
  { type: "accident",  label: "Accident",      emoji: "🚨", color: "#E53935" },
  { type: "pothole",   label: "Pothole",       emoji: "🕳️", color: "#F57C00" },
  { type: "roadblock", label: "Roadblock",     emoji: "🚧", color: "#7B1FA2" },
  { type: "clear",     label: "Road Clear",    emoji: "✅", color: "#00C853" },
];

export default function ReportModal({ visible, onClose, onSubmit }: ReportModalProps) {
  const c = useColors();
  const [sel, setSel] = useState<ReportType | null>(null);

  const submit = () => {
    if (!sel) return;
    onSubmit(sel);
    setSel(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />
          <Text style={[styles.title, { color: c.foreground }]}>Report an Incident</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            What do you see at your current location?
          </Text>

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
                  onPress={() => setSel(t.type)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.chipEmoji}>{t.emoji}</Text>
                  <Text
                    style={[
                      styles.chipLabel,
                      { color: active ? t.color : c.foreground },
                      active && { fontFamily: "Inter_600SemiBold" },
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: c.border }]}
              onPress={() => { setSel(null); onClose(); }}
            >
              <Text style={[styles.cancelTxt, { color: c.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: sel ? c.primary : c.muted }]}
              onPress={submit}
              disabled={!sel}
            >
              {sel && <Text style={{ fontSize: 16 }}>{TYPES.find((t) => t.type === sel)?.emoji}</Text>}
              <Text style={[styles.submitTxt, { color: sel ? c.primaryForeground : c.mutedForeground }]}>
                {sel ? `Report ${TYPES.find((t) => t.type === sel)?.label}` : "Select one above"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingBottom: 48,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
    width: "47%",
  },
  chipEmoji: { fontSize: 20 },
  chipLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1 },
  actions: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 0.4,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  submitTxt: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
