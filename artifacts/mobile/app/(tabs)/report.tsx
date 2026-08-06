/**
 * Report tab — opened by the center green "+" button in the tab bar.
 * Hosts the full ReportModal flow (same submit logic as Drive Mode: route/road
 * snapping, crosshair picker at screen root, confirmation audio).
 * Full page redesign is a follow-up task.
 */

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CrosshairPickerModal } from "@/components/CrosshairPicker";
import ReportModal from "@/components/ReportModal";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { speakAlert } from "@/utils/alertTts";
import { playSound } from "@/utils/sound";
import { snapToRoad } from "@/utils/snapToRoad";

export default function ReportScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    addReport,
    currentLat,
    currentLng,
    snapToActiveRoute,
    setMapPickerActive,
  } = useApp();
  const [showReport, setShowReport] = useState(false);
  const [crosshairRequest, setCrosshairRequest] = useState<{
    lat: number; lng: number; onConfirm: (lat: number, lng: number) => void;
  } | null>(null);
  const tabBarH = Platform.OS === "web" ? 84 : 96;

  // Auto-open the report sheet whenever this tab gains focus.
  useFocusEffect(
    useCallback(() => {
      setShowReport(true);
      return () => {
        setShowReport(false);
        setCrosshairRequest(null);
        setMapPickerActive(false);
      };
    }, [setMapPickerActive]),
  );

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top + 16, paddingBottom: tabBarH }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.primary + "1E", borderColor: c.primary + "44" }]}>
        <Ionicons name="warning-outline" size={28} color={c.primary} />
      </View>
      <Text style={[styles.title, { color: c.foreground }]}>Report an incident</Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        Help other drivers by reporting police, cameras, accidents and hazards.
      </Text>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: c.primary }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setShowReport(true);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={18} color={c.isDark ? "#04170B" : "#FFFFFF"} />
        <Text style={[styles.btnTxt, { color: c.isDark ? "#04170B" : "#FFFFFF" }]}>New Report</Text>
      </TouchableOpacity>

      <ReportModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        currentLat={currentLat}
        currentLng={currentLng}
        onOpenMapPicker={(initialLat, initialLng, onConfirm) => {
          // iOS: dismiss ReportModal fully before presenting the picker.
          setMapPickerActive(true);
          setShowReport(false);
          setTimeout(() => {
            setCrosshairRequest({ lat: initialLat, lng: initialLng, onConfirm });
          }, 320);
        }}
        onSubmit={async (type, speedLimit, location) => {
          setShowReport(false);
          if (location) {
            addReport(type, location.lat, location.lng, speedLimit);
          } else if (currentLat !== null && currentLng !== null) {
            try {
              const routeSnap = snapToActiveRoute(currentLat, currentLng);
              const snapped = routeSnap ?? await snapToRoad(currentLat, currentLng);
              addReport(type, snapped.lat, snapped.lng, speedLimit);
            } catch {
              addReport(type, currentLat, currentLng, speedLimit);
            }
          }
          playSound("confirm").catch(() => {});
          speakAlert("report_submitted").catch(() => {});
        }}
      />

      {/* Rendered at screen root — never nested inside another Modal. */}
      <CrosshairPickerModal
        visible={!!crosshairRequest}
        initialLat={crosshairRequest?.lat ?? -1.2921}
        initialLng={crosshairRequest?.lng ?? 36.8219}
        title="Pin the Incident Spot"
        onCancel={() => {
          setCrosshairRequest(null);
          setShowReport(true);
        }}
        onConfirm={(lat, lng) => {
          crosshairRequest?.onConfirm(lat, lng);
          setCrosshairRequest(null);
          setShowReport(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20, borderWidth: 1,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 16, paddingHorizontal: 22, paddingVertical: 13, marginTop: 12,
  },
  btnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
