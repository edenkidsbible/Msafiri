import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { TripData } from "@/context/AppContext";

function dur(ms: number): string {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m} min`;
}

function dist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function dateStr(ts: number): string {
  return new Date(ts).toLocaleDateString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

export default function TripCard({ trip }: { trip: TripData }) {
  const c = useColors();
  const elapsed = (trip.endTime || Date.now()) - trip.startTime;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.head}>
        <View>
          <Text style={[styles.date, { color: c.foreground }]}>{dateStr(trip.startTime)}</Text>
          <Text style={[styles.time, { color: c.mutedForeground }]}>
            {timeStr(trip.startTime)} – {timeStr(trip.endTime || Date.now())}
          </Text>
        </View>
        <View style={[styles.durBadge, { backgroundColor: c.muted }]}>
          <Text style={[styles.durText, { color: c.mutedForeground }]}>{dur(elapsed)}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        {[
          { icon: "speedometer-outline", val: `${Math.round(trip.avgSpeed)}`, lbl: "Avg km/h", col: c.primary },
          { icon: "flash-outline", val: `${Math.round(trip.maxSpeed)}`, lbl: "Max km/h", col: c.speedCaution },
          { icon: "navigate-outline", val: dist(trip.distance), lbl: "Distance", col: c.primary },
          {
            icon: "alert-circle-outline",
            val: `${trip.alertsCount}`,
            lbl: "Alerts",
            col: trip.alertsCount > 0 ? c.speedDanger : c.mutedForeground,
          },
        ].map((s, i, arr) => (
          <React.Fragment key={s.lbl}>
            <View style={styles.stat}>
              <Ionicons name={s.icon as "speedometer-outline"} size={17} color={s.col} />
              <Text style={[styles.val, { color: s.col === c.mutedForeground ? c.foreground : s.col }]}>
                {s.val}
              </Text>
              <Text style={[styles.lbl, { color: c.mutedForeground }]}>{s.lbl}</Text>
            </View>
            {i < arr.length - 1 && (
              <View style={[styles.div, { backgroundColor: c.border }]} />
            )}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  date: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  time: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  durBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  durText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  stats: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  val: { fontSize: 14, fontFamily: "Inter_700Bold" },
  lbl: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "center" },
  div: { width: 1, height: 38, marginHorizontal: 4 },
});
