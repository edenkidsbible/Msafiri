/**
 * Restore Data screen
 *
 * Two-step recovery flow:
 *   Step 1 — Enter 5-char recovery code
 *   Step 2 — Enter at least one plate number from any vehicle in the account
 *
 * On success: vehicles are written to AsyncStorage, settings are restored,
 * and the user is directed to restart the app.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useVehicle } from "@/context/VehicleContext";
import { verifyAndRestore } from "@/utils/backupSync";
import { saveVehicles, setPrimaryVehicleIdIfUnset } from "@/utils/savedVehicles";

export default function RestoreDataScreen() {
  const c      = useColors();
  const { deviceId, setDriverName, setThemeOverride, setVehicleType } = useApp();
  const { refreshVehicles } = useVehicle();

  const [step,      setStep]      = useState<1 | 2>(1);
  const [code,      setCode]      = useState("");
  const [plate,     setPlate]     = useState("");
  const [loading,   setLoading]   = useState(false);

  const bg        = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg    = c.isDark ? "#131F17" : "#fff";
  const border    = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg   = c.isDark ? "#1A2820" : "#F0F6F1";

  // ── Step 1: proceed to plate entry ────────────────────────────────────────
  const handleCodeNext = () => {
    const cleaned = code.trim().toUpperCase().replace(/\s/g, "");
    if (cleaned.length !== 5) {
      Alert.alert("Invalid code", "Please enter your 5-character recovery code.");
      return;
    }
    setCode(cleaned);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(2);
  };

  // ── Step 2: verify + restore ──────────────────────────────────────────────
  const handleRestore = async () => {
    const cleanPlate = plate.trim();
    if (!cleanPlate) {
      Alert.alert("Plate required", "Enter at least one plate number from any vehicle in the account.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID is not available. Please restart the app.");
      return;
    }

    setLoading(true);
    try {
      const { vehicles, settings } = await verifyAndRestore(code, cleanPlate, deviceId);

      if (!vehicles || vehicles.length === 0) {
        Alert.alert("Nothing to restore", "No vehicle data was found for this account.");
        setLoading(false);
        return;
      }

      // Write vehicles to AsyncStorage
      await saveVehicles(vehicles);
      if (vehicles[0]) await setPrimaryVehicleIdIfUnset(vehicles[0].id);
      await refreshVehicles();

      // Restore settings
      if (settings.driverName)   setDriverName(settings.driverName);
      if (settings.vehicleType)  setVehicleType(settings.vehicleType as any);
      if (settings.themeOverride) setThemeOverride(settings.themeOverride as any);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Alert.alert(
        "✅ Data Restored",
        `${vehicles.length} vehicle${vehicles.length !== 1 ? "s" : ""} and your settings have been restored successfully. Your trip history and saved places are linked to this device automatically.`,
        [{ text: "Done", onPress: () => router.replace("/(tabs)") }],
      );
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found") || msg.toLowerCase().includes("404")) {
        Alert.alert(
          "Code not found",
          "We couldn't find an account with that recovery code. Double-check the code and try again.",
        );
      } else if (msg.includes("Plate") || msg.toLowerCase().includes("403")) {
        Alert.alert(
          "Plate doesn't match",
          "The plate number you entered doesn't match any vehicle in that account. Try another plate or check your code.",
        );
      } else {
        Alert.alert("Restore failed", "Check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: c.foreground }]}>Restore My Data</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Icon + intro */}
          <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="shield-checkmark" size={38} color={c.primary} />
          </View>

          <Text style={[s.heading, { color: c.foreground }]}>
            {step === 1 ? "Enter your recovery code" : "Verify your identity"}
          </Text>
          <Text style={[s.sub, { color: c.mutedForeground }]}>
            {step === 1
              ? "Type the 5-character code shown in your previous app's Settings screen. It looks like: A7K2M"
              : "For security, enter at least one number plate from any vehicle you had in the account."}
          </Text>

          {/* Step indicators */}
          <View style={s.stepRow}>
            {([1, 2] as const).map((n) => (
              <View key={n} style={s.stepItem}>
                <View style={[s.stepDot, { backgroundColor: step >= n ? c.primary : border }]}>
                  <Text style={[s.stepDotTxt, { color: step >= n ? "#fff" : c.mutedForeground }]}>{n}</Text>
                </View>
                <Text style={[s.stepLbl, { color: step >= n ? c.primary : c.mutedForeground }]}>
                  {n === 1 ? "Recovery code" : "Plate number"}
                </Text>
              </View>
            ))}
          </View>

          {/* ── Step 1: Code entry ── */}
          {step === 1 && (
            <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>RECOVERY CODE</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="e.g. A7K2M"
                placeholderTextColor={c.mutedForeground + "88"}
                autoCapitalize="characters"
                maxLength={5}
                style={[s.codeInput, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                autoFocus
                keyboardType="default"
              />
              <Text style={[s.hint, { color: c.mutedForeground }]}>
                This code was generated during your first app setup. Find it under Settings → Data &amp; Recovery in your old device.
              </Text>
            </View>
          )}

          {/* ── Step 2: Plate entry ── */}
          {step === 2 && (
            <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>NUMBER PLATE</Text>
              <TextInput
                value={plate}
                onChangeText={(t) => setPlate(t.toUpperCase())}
                placeholder="e.g. KCB 123A"
                placeholderTextColor={c.mutedForeground + "88"}
                autoCapitalize="characters"
                style={[s.codeInput, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                autoFocus
              />
              <Text style={[s.hint, { color: c.mutedForeground }]}>
                Enter a plate for any car you had in the account — if you have more than one vehicle, any correct plate will work.
              </Text>

              {/* Code recap chip */}
              <View style={[s.codeChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
                <Ionicons name="key-outline" size={13} color={c.primary} />
                <Text style={[s.codeChipTxt, { color: c.primary }]}>Code: {code}</Text>
                <TouchableOpacity onPress={() => setStep(1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium" as const, color: c.mutedForeground }}>Change</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* CTA */}
          <TouchableOpacity
            style={[s.cta, { backgroundColor: (step === 1 ? code.length === 5 : !!plate.trim()) ? c.primary : c.muted, opacity: loading ? 0.7 : 1 }]}
            onPress={step === 1 ? handleCodeNext : handleRestore}
            disabled={loading || (step === 1 ? code.length !== 5 : !plate.trim())}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <Text style={s.ctaTxt}>{step === 1 ? "Continue" : "Verify & Restore"}</Text>
                  <Ionicons name={step === 1 ? "arrow-forward" : "shield-checkmark"} size={16} color="#fff" />
                </>
              )}
          </TouchableOpacity>

          {step === 2 && (
            <Text style={[s.footer, { color: c.mutedForeground }]}>
              Both your recovery code and a correct plate are required to protect your data from unauthorised access.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:     { flex: 1 },
  header:     { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn:    { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title:      { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  body:       { padding: 20, paddingBottom: 48, gap: 20 },
  iconWrap:   { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  heading:    { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub:        { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center" },
  stepRow:    { flexDirection: "row", justifyContent: "center", gap: 36 },
  stepItem:   { alignItems: "center", gap: 6 },
  stepDot:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepLbl:    { fontSize: 11, fontFamily: "Inter_500Medium" },
  card:       { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  codeInput:  {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 20, fontFamily: "Inter_700Bold",
    textAlign: "center", letterSpacing: 4,
  },
  hint:       { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  codeChip:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  codeChipTxt:{ fontSize: 12, fontFamily: "Inter_700Bold" },
  cta:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  footer:     { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, textAlign: "center" },
});
