export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function NotificationsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    notif_speed_camera: true,
    notif_police: true,
    notif_hazards: true,
    notif_traffic: true,
    notif_nearby_incidents: true,
    notif_app_updates: true,
    notif_safety_tips: false,
  });

  useEffect(() => {
    const load = async () => {
      const keys = Object.keys(toggles);
      const values = await AsyncStorage.multiGet(keys);
      const updates: Record<string, boolean> = {};
      for (const [key, val] of values) {
        if (val !== null) updates[key] = val === "true";
      }
      setToggles(prev => ({ ...prev, ...updates }));
    };
    load();
  }, []);

  const handleToggle = async (key: string, value: boolean) => {
    setToggles(prev => ({ ...prev, [key]: value }));
    await AsyncStorage.setItem(key, value.toString());
  };

  const ToggleRow = ({ title, sub, icon, iconColor, toggleKey, isLast }: any) => {
    const value = toggles[toggleKey] ?? true;
    return (
      <View>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: iconColor + "22" }]}>
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: c.foreground }]}>{title}</Text>
            <Text style={[styles.rowSub, { color: c.mutedForeground }]}>{sub}</Text>
          </View>
          <Switch
            value={value}
            onValueChange={(val) => handleToggle(toggleKey, val)}
            trackColor={{ false: c.border, true: c.primary }}
            thumbColor="#fff"
          />
        </View>
        {!isLast && <View style={[styles.divider, { backgroundColor: c.border }]} />}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Control which alerts you receive while driving</Text>
        
        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>Driving Alerts</Text>
        <View style={[styles.cardGroup, { backgroundColor: c.card }]}>
          <ToggleRow title="Speed Camera Ahead" sub="Alert when approaching a speed camera" icon="camera-outline" iconColor="#EF4444" toggleKey="notif_speed_camera" />
          <ToggleRow title="Police Checkpoint" sub="Alert near police presence" icon="shield-outline" iconColor="#3B82F6" toggleKey="notif_police" />
          <ToggleRow title="Hazards & Obstacles" sub="Potholes, debris, and road hazards" icon="warning-outline" iconColor="#F59E0B" toggleKey="notif_hazards" />
          <ToggleRow title="Traffic Jams" sub="Congestion and slow traffic alerts" icon="car-outline" iconColor="#F59E0B" toggleKey="notif_traffic" />
          <ToggleRow title="Nearby Incidents" sub="Community-reported incidents around you" icon="location-outline" iconColor={c.primary} toggleKey="notif_nearby_incidents" isLast />
        </View>

        <Text style={[styles.sectionLabel, { color: c.mutedForeground }]}>General</Text>
        <View style={[styles.cardGroup, { backgroundColor: c.card }]}>
          <ToggleRow title="App Updates" sub="New features and improvements" icon="refresh-outline" iconColor="#3B82F6" toggleKey="notif_app_updates" />
          <ToggleRow title="Safety Tips" sub="Weekly road safety reminders" icon="heart-outline" iconColor="#EC4899" toggleKey="notif_safety_tips" isLast />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8, marginTop: 20, paddingHorizontal: 20, textTransform: "uppercase" },
  cardGroup: { borderRadius: 16, overflow: "hidden", marginBottom: 4, marginHorizontal: 16 },
  
  row: { flexDirection: "row", alignItems: "center", padding: 14 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  rowText: { flex: 1, minWidth: 0, paddingRight: 8 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
});
