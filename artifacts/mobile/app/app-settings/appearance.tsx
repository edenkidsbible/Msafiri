export { ErrorBoundary } from "@/components/ErrorBoundary";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

export default function AppearanceScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { themeOverride, setThemeOverride } = useApp();

  const options = [
    { value: "system", title: "Automatic", sub: "Match your device system setting", icon: "moon-outline", color: "#8B5CF6" },
    { value: "light", title: "Light Mode", sub: "Always use light theme", icon: "sunny-outline", color: "#F59E0B" },
    { value: "dark", title: "Dark Mode", sub: "Always use dark theme", icon: "moon", color: "#3B82F6" },
  ] as const;

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { backgroundColor: c.background, borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Appearance</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.subtitle, { color: c.mutedForeground }]}>Choose how Msafiri looks on your device</Text>
        
        <View style={{ gap: 12, paddingHorizontal: 16 }}>
          {options.map((opt) => {
            const isSelected = themeOverride === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.optionCard,
                  { backgroundColor: c.card },
                  isSelected && { borderLeftWidth: 3, borderLeftColor: c.primary }
                ]}
                onPress={() => setThemeOverride(opt.value)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBox, { backgroundColor: opt.color + "22" }]}>
                  <Ionicons name={opt.icon as any} size={20} color={opt.color} />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionTitle, { color: c.foreground }]}>{opt.title}</Text>
                  <Text style={[styles.optionSub, { color: c.mutedForeground }]}>{opt.sub}</Text>
                </View>
                <View style={[
                  styles.checkCircle,
                  isSelected ? { backgroundColor: c.primary, borderColor: c.primary } : { borderColor: c.border }
                ]}>
                  {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            );
          })}
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
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", paddingHorizontal: 16, marginTop: 12, marginBottom: 20 },
  
  optionCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 16 },
  iconBox: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 12 },
  optionText: { flex: 1, minWidth: 0 },
  optionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  optionSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  
  checkCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 12 },
});
