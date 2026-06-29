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

const TYPES: Array<{ type: ReportType; label: string; color: string }> = [
  { type: "camera", label: "Speed Camera", color: "#E53935" },
  { type: "police", label: "Police Check", color: "#1565C0" },
  { type: "accident", label: "Accident", color: "#E53935" },
  { type: "pothole", label: "Pothole", color: "#F57C00" },
  { type: "roadblock", label: "Roadblock", color: "#7B1FA2" },
  { type: "clear", label: "Road Clear", color: "#00C853" },
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <Text style={[styles.title, { color: c.foreground }]}>Report an Incident</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            What do you see at your current location?
          </Text>

          <View style={styles.grid}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t.type}
                style={[
                  styles.chip,
                  {
                    backgroundColor: sel === t.type ? t.color + "22" : c.muted,
                    borderColor: sel === t.type ? t.color : c.border,
                  },
                ]}
                onPress={() => setSel(t.type)}
                activeOpacity={0.75}
              >
                <View style={[styles.dot, { backgroundColor: t.color }]} />
                <Text
                  style={[
                    styles.chipLabel,
                    { color: sel === t.type ? t.color : c.foreground },
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
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
              <Text style={[styles.submitTxt, { color: sel ? c.primaryForeground : c.mutedForeground }]}>
                Report
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
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 24,
    paddingBottom: 44,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    width: "47%",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  actions: { flexDirection: "row", gap: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  submitBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  submitTxt: { fontSize: 15, fontFamily: "Inter_700Bold" },
});
