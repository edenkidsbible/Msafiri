import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp, CommunityReport } from "@/context/AppContext";
import { resolveIncidentType } from "@/constants/incidentTypes";

interface Props {
  report: CommunityReport;
  onDismiss: () => void;
}

export default function IncidentConfirmationPrompt({ report, onDismiss }: Props) {
  const c = useColors();
  const { confirmReport, denyReport } = useApp();
  const def = resolveIncidentType(report.type);
  const id = report.serverId ?? report.id;

  const handleStillHere = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDismiss();
    await confirmReport(id);
  };

  const handleGoneNow = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onDismiss();
    await denyReport(id);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.iconRow}>
            <View style={[styles.iconCircle, { backgroundColor: def.color + "22" }]}>
              <Text style={styles.emoji}>{def.emoji}</Text>
            </View>
          </View>

          <Text style={[styles.question, { color: c.foreground }]}>
            Is {def.label} still there?
          </Text>

          {report.roadName ? (
            <Text style={[styles.road, { color: c.mutedForeground }]} numberOfLines={1}>
              on {report.roadName}
            </Text>
          ) : null}

          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            Your confirmation helps nearby drivers stay informed.
          </Text>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.goneBtn]}
              onPress={handleGoneNow}
              activeOpacity={0.82}
            >
              <Ionicons name="checkmark-circle-outline" size={18} color="#FFF" />
              <Text style={styles.goneBtnTxt}>Gone Now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.hereBtn, { backgroundColor: def.color }]}
              onPress={handleStillHere}
              activeOpacity={0.82}
            >
              <Ionicons name="warning-outline" size={18} color="#FFF" />
              <Text style={styles.hereBtnTxt}>Still Here</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.skipBtn} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={[styles.skipTxt, { color: c.mutedForeground }]}>Not sure — skip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 44,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 20,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  iconRow: {
    marginBottom: 14,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 36,
  },
  question: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 6,
  },
  road: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginBottom: 6,
  },
  sub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginBottom: 28,
    paddingHorizontal: 8,
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    marginBottom: 16,
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 16,
  },
  goneBtn: {
    backgroundColor: "#4CAF50",
  },
  goneBtnTxt: {
    color: "#FFF",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  hereBtn: {},
  hereBtnTxt: {
    color: "#FFF",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipTxt: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});
