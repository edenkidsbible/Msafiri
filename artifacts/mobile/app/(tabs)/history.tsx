import React from "react";
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import TripCard from "@/components/TripCard";
import { TripData } from "@/context/AppContext";

function distStr(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export default function HistoryScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { tripHistory, clearTripHistory, currentTrip } = useApp();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const totalDist = tripHistory.reduce((s, t) => s + t.distance, 0);
  const totalTrips = tripHistory.length;
  const totalAlerts = tripHistory.reduce((s, t) => s + t.alertsCount, 0);

  const onClear = () => {
    Alert.alert("Clear History", "Remove all saved trips? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: clearTripHistory },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color={c.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: c.foreground, flex: 1, marginLeft: 4 }]}>Trip History</Text>
          {tripHistory.length > 0 && (
            <TouchableOpacity onPress={onClear}>
              <Ionicons name="trash-outline" size={20} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Summary stats */}
        {tripHistory.length > 0 && (
          <View style={[styles.summaryRow]}>
            <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.summaryVal, { color: c.primary }]}>{totalTrips}</Text>
              <Text style={[styles.summaryLbl, { color: c.mutedForeground }]}>Trips</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.summaryVal, { color: c.primary }]}>{distStr(totalDist)}</Text>
              <Text style={[styles.summaryLbl, { color: c.mutedForeground }]}>Total</Text>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.summaryVal, { color: totalAlerts > 0 ? c.speedDanger : c.primary }]}>
                {totalAlerts}
              </Text>
              <Text style={[styles.summaryLbl, { color: c.mutedForeground }]}>Alerts</Text>
            </View>
          </View>
        )}

        {/* Active trip indicator */}
        {currentTrip && (
          <View style={[styles.activeTrip, { backgroundColor: c.primary + "18", borderColor: c.primary + "44" }]}>
            <View style={[styles.activeDot, { backgroundColor: c.speedSafe }]} />
            <Text style={[styles.activeTripText, { color: c.primary }]}>
              Trip in progress — {distStr(currentTrip.distance ?? 0)} · {Math.round(currentTrip.avgSpeed ?? 0)} km/h avg
            </Text>
          </View>
        )}
      </View>

      <FlatList
        data={tripHistory}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <TripCard trip={item} />}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: bottomInset + 100 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={tripHistory.length > 0}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={52} color={c.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: c.foreground }]}>No trips yet</Text>
            <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
              Start driving and your trips will appear here automatically.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  summaryCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  summaryVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLbl: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  activeTrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  activeDot: { width: 8, height: 8, borderRadius: 4 },
  activeTripText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
