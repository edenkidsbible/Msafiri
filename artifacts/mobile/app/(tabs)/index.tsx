import React, { useEffect } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import SpeedometerDial from "@/components/SpeedometerDial";
import AlertBanner from "@/components/AlertBanner";
import SOSButton from "@/components/SOSButton";

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export default function DriveScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    locationGranted,
    requestLocationPermission,
    currentSpeed,
    currentSpeedLimit,
    activeAlert,
    dismissAlert,
    nearbyZones,
    hudMode,
    setHudMode,
    currentTrip,
  } = useApp();

  useEffect(() => {
    if (!locationGranted) requestLocationPermission();
  }, []);

  // Activate keep-awake in HUD mode
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cleanup: (() => void) | undefined;
    (async () => {
      if (hudMode) {
        const KA = await import("expo-keep-awake");
        await KA.activateKeepAwakeAsync();
        cleanup = () => KA.deactivateKeepAwake();
      }
    })();
    return () => cleanup?.();
  }, [hudMode]);

  const overLimit =
    currentSpeedLimit != null && currentSpeed > currentSpeedLimit;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View
      style={[styles.screen, { backgroundColor: hudMode ? "#000" : c.background }]}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <View>
          <Text style={[styles.appTitle, { color: hudMode ? "#FFFFFF" : c.foreground }]}>
            SafeDrive Kenya
          </Text>
          {currentTrip && (
            <View style={styles.tripPill}>
              <View style={[styles.tripDot, { backgroundColor: c.speedSafe }]} />
              <Text style={[styles.tripText, { color: c.speedSafe }]}>
                Trip in progress
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setHudMode(!hudMode);
            }}
            style={[
              styles.iconBtn,
              { backgroundColor: hudMode ? "#FFFFFF22" : c.muted },
            ]}
          >
            <Ionicons
              name={hudMode ? "sunny" : "moon-outline"}
              size={20}
              color={hudMode ? "#FFFFFF" : c.foreground}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/settings")}
            style={[styles.iconBtn, { backgroundColor: hudMode ? "#FFFFFF22" : c.muted }]}
          >
            <Ionicons
              name="settings-outline"
              size={20}
              color={hudMode ? "#FFFFFF" : c.foreground}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Alert Banner */}
      {activeAlert && (
        <AlertBanner zone={activeAlert} onDismiss={dismissAlert} />
      )}

      {/* Speedometer */}
      <View style={styles.dialWrap}>
        <SpeedometerDial
          speed={currentSpeed}
          speedLimit={currentSpeedLimit}
          hudMode={hudMode}
        />

        {overLimit && (
          <View style={[styles.overLimitBanner, { backgroundColor: c.speedDanger }]}>
            <Ionicons name="alert-circle" size={16} color="#FFFFFF" />
            <Text style={styles.overLimitText}>Slow down!</Text>
          </View>
        )}
      </View>

      {/* Permission prompt */}
      {!locationGranted && (
        <TouchableOpacity
          style={[styles.permBtn, { backgroundColor: c.primary }]}
          onPress={requestLocationPermission}
          activeOpacity={0.85}
        >
          <Ionicons name="location-outline" size={18} color={c.primaryForeground} />
          <Text style={[styles.permText, { color: c.primaryForeground }]}>
            Enable Location
          </Text>
        </TouchableOpacity>
      )}

      {/* Nearby zones */}
      {!hudMode && nearbyZones.length > 0 && (
        <View style={styles.nearbySection}>
          <Text style={[styles.nearbyTitle, { color: c.mutedForeground }]}>
            UPCOMING ZONES
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nearbyScroll}>
            {nearbyZones.slice(0, 5).map((z) => (
              <View
                key={z.id}
                style={[styles.zoneChip, { backgroundColor: c.card, borderColor: c.border }]}
              >
                <Ionicons
                  name={z.type === "camera" ? "camera" : z.type === "police" ? "shield" : "warning"}
                  size={14}
                  color={z.distance < 1000 ? c.speedCaution : c.mutedForeground}
                />
                <Text style={[styles.zoneLimit, { color: c.foreground }]}>{z.speedLimit}</Text>
                <Text style={[styles.zoneKmh, { color: c.mutedForeground }]}>km/h</Text>
                <Text style={[styles.zoneDist, { color: c.mutedForeground }]}>
                  {distStr(z.distance)}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* SOS Button */}
      <View style={[styles.sosWrap, { bottom: bottomInset + (Platform.OS === "web" ? 90 : 96) }]}>
        <SOSButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  appTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  tripPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 3,
  },
  tripDot: { width: 6, height: 6, borderRadius: 3 },
  tripText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  headerRight: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  dialWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    flex: 1,
  },
  overLimitBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 24,
    marginTop: 16,
  },
  overLimitText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  permBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 28,
    marginBottom: 16,
  },
  permText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  nearbySection: { paddingBottom: 8 },
  nearbyTitle: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
    marginLeft: 20,
    marginBottom: 8,
  },
  nearbyScroll: { paddingLeft: 16 },
  zoneChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  zoneLimit: { fontSize: 14, fontFamily: "Inter_700Bold" },
  zoneKmh: { fontSize: 10, fontFamily: "Inter_400Regular" },
  zoneDist: { fontSize: 11, fontFamily: "Inter_400Regular" },
  sosWrap: {
    position: "absolute",
    right: 20,
  },
});
