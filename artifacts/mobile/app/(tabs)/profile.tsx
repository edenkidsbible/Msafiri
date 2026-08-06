/**
 * Profile tab — placeholder shell (full redesign is a follow-up task).
 * Links the existing profile-adjacent features: settings, learn, fines, about.
 */

import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const LINKS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; href: string }[] = [
  { icon: "settings-outline",  title: "Settings",       sub: "Appearance, alerts & account",  href: "/(tabs)/settings" },
  { icon: "school-outline",    title: "Learn",          sub: "Road safety courses",           href: "/(tabs)/learn" },
  { icon: "receipt-outline",   title: "Fines",          sub: "NTSA fines & payments",         href: "/(tabs)/fines" },
  { icon: "compass-outline",   title: "Browse",         sub: "Blogs, guides & more",          href: "/(tabs)/browse" },
  { icon: "information-circle-outline", title: "About", sub: "App info & legal",              href: "/about" },
];

export default function ProfileScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { driverName } = useApp();
  const tabBarH = Platform.OS === "web" ? 84 : 96;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 14, paddingHorizontal: 16,
        paddingBottom: tabBarH + insets.bottom + 24,
      }}>
        <View style={styles.headRow}>
          <View style={[styles.avatar, { backgroundColor: c.primary + "1E", borderColor: c.primary + "44" }]}>
            <Ionicons name="person" size={26} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
              {driverName || "Driver"}
            </Text>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Msafiri Kenya member</Text>
          </View>
        </View>
        <View style={{ gap: 10, marginTop: 18 }}>
          {LINKS.map((l) => (
            <TouchableOpacity
              key={l.title}
              activeOpacity={0.8}
              onPress={() => router.push(l.href as any)}
              style={[styles.card, { backgroundColor: c.card, borderColor: c.tileBorder }]}
            >
              <View style={[styles.cardIcon, { backgroundColor: c.primary + "1E" }]}>
                <Ionicons name={l.icon} size={20} color={c.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.cardTitle, { color: c.foreground }]}>{l.title}</Text>
                <Text style={[styles.cardSub, { color: c.mutedForeground }]} numberOfLines={1}>{l.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 56, height: 56, borderRadius: 18, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  cardIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
