import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { resolveIncidentType } from "@/constants/incidentTypes";
import { EMOJI_FONT_FAMILY } from "@/constants/emojiFont";
import type { CommunityReport } from "@/context/AppContext";

const AUTO_HIDE_MS = 5000;

export interface UndoableReport {
  id: string;
  type: CommunityReport["type"];
}

interface ReportUndoToastProps {
  report: UndoableReport | null;
  bottom: number;
  onUndo: () => void;
  onDismiss: () => void;
}

/** Brief "Reported — Undo" confirmation shown after a one-tap report so a
 *  driver gets a cheap safety net against a mis-tap, instead of a
 *  confirm-before-you-submit step slowing down every report. */
export default function ReportUndoToast({ report, bottom, onUndo, onDismiss }: ReportUndoToastProps) {
  const c = useColors();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (report) timerRef.current = setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  if (!report) return null;
  const def = resolveIncidentType(report.type);

  return (
    <View style={[styles.wrap, { bottom, backgroundColor: c.foreground }]}>
      <Text style={styles.emoji}>{def.emoji}</Text>
      <Text style={[styles.text, { color: c.background }]} numberOfLines={1}>
        {def.label} reported
      </Text>
      <TouchableOpacity onPress={onUndo} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={[styles.undo, { color: c.primary }]}>Undo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  emoji: { fontSize: 16, fontFamily: EMOJI_FONT_FAMILY },
  text: { flex: 1, fontSize: 13.5, fontFamily: "Inter_600SemiBold" },
  undo: { fontSize: 13.5, fontFamily: "Inter_700Bold" },
});
