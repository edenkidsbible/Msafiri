/**
 * Restore Data screen
 *
 * Primary flow — Phone OTP (recommended):
 *   Step 1 — Enter phone number → "Send Code"
 *   Step 2 — Enter 6-digit OTP  → "Verify & Restore"
 *
 * Fallback flow — Recovery code (for users from before phone linking):
 *   Step 1 — Enter 5-char code
 *   Step 2 — Enter a plate number from the account
 *
 * Toggle between flows via the footer link.
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
import { sendOtp, restoreViaPhone, verifyAndRestore } from "@/utils/backupSync";
import { saveVehicles, setPrimaryVehicleIdIfUnset } from "@/utils/savedVehicles";

type Mode = "phone" | "code";

export default function RestoreDataScreen() {
  const c      = useColors();
  const { deviceId, setDriverName, setThemeOverride, setVehicleType } = useApp();
  const { refreshVehicles } = useVehicle();

  const [mode,    setMode]    = useState<Mode>("phone");

  // ── Phone OTP flow state ───────────────────────────────────────────────────
  const [step,    setStep]    = useState<1 | 2>(1);
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");

  // ── Recovery-code flow state ───────────────────────────────────────────────
  const [codeStep, setCodeStep] = useState<1 | 2>(1);
  const [code,    setCode]    = useState("");
  const [plate,   setPlate]   = useState("");

  const [loading, setLoading] = useState(false);

  const bg      = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  // ── Shared: apply restored data ────────────────────────────────────────────
  const applyRestore = async (
    vehicles: any[],
    settings: Record<string, any>,
  ) => {
    if (!vehicles || vehicles.length === 0) {
      Alert.alert("Nothing to restore", "No vehicle data was found for this account.");
      return;
    }
    await saveVehicles(vehicles);
    if (vehicles[0]) await setPrimaryVehicleIdIfUnset(vehicles[0].id);
    await refreshVehicles();

    if (settings.driverName)    setDriverName(settings.driverName);
    if (settings.vehicleType)   setVehicleType(settings.vehicleType as any);
    if (settings.themeOverride) setThemeOverride(settings.themeOverride as any);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    Alert.alert(
      "✅ Data Restored",
      `${vehicles.length} vehicle${vehicles.length !== 1 ? "s" : ""} and your settings have been restored. Trip history and saved places are linked to this device automatically.`,
      [{ text: "Done", onPress: () => router.replace("/(tabs)") }],
    );
  };

  // ── Phone flow: Step 1 — send OTP ─────────────────────────────────────────
  const handleSend = async () => {
    const clean = phone.trim();
    if (!clean) {
      Alert.alert("Phone required", "Enter the phone number linked to your account.");
      return;
    }
    setLoading(true);
    try {
      await sendOtp(clean);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(2);
    } catch (err: any) {
      Alert.alert("Couldn't send code", err?.message ?? "Check your number and try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Phone flow: Step 2 — verify OTP and restore ────────────────────────────
  const handlePhoneRestore = async () => {
    const cleanOtp = otp.trim().replace(/\s/g, "");
    if (cleanOtp.length !== 6) {
      Alert.alert("Invalid code", "Enter the 6-digit code we sent.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app.");
      return;
    }
    setLoading(true);
    try {
      const { vehicles, settings } = await restoreViaPhone(phone.trim(), cleanOtp, deviceId);
      await applyRestore(vehicles, settings);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("No account found") || msg.includes("404")) {
        Alert.alert(
          "No account found",
          "We couldn't find an account linked to this number. Make sure you're using the same number you set up on your previous device.",
        );
      } else {
        Alert.alert("Verification failed", msg || "Check the code and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Code flow: Step 1 — proceed to plate ──────────────────────────────────
  const handleCodeNext = () => {
    const cleaned = code.trim().toUpperCase().replace(/\s/g, "");
    if (cleaned.length !== 5) {
      Alert.alert("Invalid code", "Enter your 5-character recovery code.");
      return;
    }
    setCode(cleaned);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCodeStep(2);
  };

  // ── Code flow: Step 2 — verify code + plate and restore ───────────────────
  const handleCodeRestore = async () => {
    const cleanPlate = plate.trim();
    if (!cleanPlate) {
      Alert.alert("Plate required", "Enter a plate number from any vehicle in the account.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app.");
      return;
    }
    setLoading(true);
    try {
      const { vehicles, settings } = await verifyAndRestore(code, cleanPlate, deviceId);
      await applyRestore(vehicles, settings);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found") || msg.toLowerCase().includes("404")) {
        Alert.alert("Code not found", "We couldn't find an account with that recovery code. Double-check and try again.");
      } else if (msg.includes("Plate") || msg.toLowerCase().includes("403")) {
        Alert.alert("Plate doesn't match", "The plate doesn't match any vehicle in that account. Try another plate.");
      } else {
        Alert.alert("Restore failed", "Check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep(1);
    setCodeStep(1);
    setOtp(""); setCode(""); setPlate("");
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

          {/* Icon */}
          <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="shield-checkmark" size={38} color={c.primary} />
          </View>

          {/* ── MODE TABS ── */}
          <View style={[s.tabs, { backgroundColor: c.isDark ? "#1A2820" : "#E8F3EC", borderColor: border }]}>
            {(["phone", "code"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.tab, mode === m && { backgroundColor: c.primary }]}
                onPress={() => switchMode(m)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={m === "phone" ? "phone-portrait-outline" : "key-outline"}
                  size={14}
                  color={mode === m ? "#fff" : c.mutedForeground}
                />
                <Text style={[s.tabTxt, { color: mode === m ? "#fff" : c.mutedForeground }]}>
                  {m === "phone" ? "Phone OTP" : "Recovery Code"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ══════════════════════════════════════════════════════════════════
              PHONE OTP FLOW
          ══════════════════════════════════════════════════════════════════ */}
          {mode === "phone" && (
            <>
              <Text style={[s.heading, { color: c.foreground }]}>
                {step === 1 ? "Enter your phone number" : "Enter the code"}
              </Text>
              <Text style={[s.sub, { color: c.mutedForeground }]}>
                {step === 1
                  ? "Use the phone number you linked on your previous device."
                  : `We sent a 6-digit code to ${phone.trim()}. It expires in 10 minutes.`}
              </Text>

              {/* Step indicators */}
              <View style={s.stepRow}>
                {([1, 2] as const).map((n) => (
                  <View key={n} style={s.stepItem}>
                    <View style={[s.stepDot, { backgroundColor: step >= n ? c.primary : border }]}>
                      <Text style={[s.stepDotTxt, { color: step >= n ? "#fff" : c.mutedForeground }]}>{n}</Text>
                    </View>
                    <Text style={[s.stepLbl, { color: step >= n ? c.primary : c.mutedForeground }]}>
                      {n === 1 ? "Phone number" : "Verify code"}
                    </Text>
                  </View>
                ))}
              </View>

              {step === 1 && (
                <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>MOBILE NUMBER</Text>
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="e.g. 0712 345 678"
                    placeholderTextColor={c.mutedForeground + "88"}
                    keyboardType="phone-pad"
                    style={[s.input, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                    autoFocus
                  />
                </View>
              )}

              {step === 2 && (
                <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
                  <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>6-DIGIT CODE</Text>
                  <TextInput
                    value={otp}
                    onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ""))}
                    placeholder="• • • • • •"
                    placeholderTextColor={c.mutedForeground + "88"}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[s.otpInput, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                    autoFocus
                  />
                  <View style={[s.chip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
                    <Ionicons name="phone-portrait-outline" size={13} color={c.primary} />
                    <Text style={[s.chipTxt, { color: c.primary }]}>{phone.trim()}</Text>
                    <TouchableOpacity onPress={() => setStep(1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium" as const, color: c.mutedForeground }}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[s.cta, {
                  backgroundColor: (step === 1 ? phone.trim().length >= 9 : otp.length === 6)
                    ? c.primary : c.muted,
                  opacity: loading ? 0.7 : 1,
                }]}
                onPress={step === 1 ? handleSend : handlePhoneRestore}
                disabled={loading || (step === 1 ? phone.trim().length < 9 : otp.length !== 6)}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Text style={s.ctaTxt}>{step === 1 ? "Send Code" : "Verify & Restore"}</Text>
                      <Ionicons name={step === 1 ? "send" : "shield-checkmark"} size={16} color="#fff" />
                    </>
                  )}
              </TouchableOpacity>

              {step === 2 && (
                <TouchableOpacity onPress={handleSend} disabled={loading} style={{ alignSelf: "center" }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium" as const, color: c.mutedForeground }}>
                    Didn't receive it? Resend code
                  </Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              RECOVERY CODE FLOW (legacy)
          ══════════════════════════════════════════════════════════════════ */}
          {mode === "code" && (
            <>
              <Text style={[s.heading, { color: c.foreground }]}>
                {codeStep === 1 ? "Enter your recovery code" : "Verify your identity"}
              </Text>
              <Text style={[s.sub, { color: c.mutedForeground }]}>
                {codeStep === 1
                  ? "Type the 5-character code from Settings → Data & Recovery on your old device."
                  : "For security, enter at least one plate number from any vehicle in the account."}
              </Text>

              <View style={s.stepRow}>
                {([1, 2] as const).map((n) => (
                  <View key={n} style={s.stepItem}>
                    <View style={[s.stepDot, { backgroundColor: codeStep >= n ? c.primary : border }]}>
                      <Text style={[s.stepDotTxt, { color: codeStep >= n ? "#fff" : c.mutedForeground }]}>{n}</Text>
                    </View>
                    <Text style={[s.stepLbl, { color: codeStep >= n ? c.primary : c.mutedForeground }]}>
                      {n === 1 ? "Recovery code" : "Plate number"}
                    </Text>
                  </View>
                ))}
              </View>

              {codeStep === 1 && (
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
                  />
                </View>
              )}

              {codeStep === 2 && (
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
                  <View style={[s.chip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
                    <Ionicons name="key-outline" size={13} color={c.primary} />
                    <Text style={[s.chipTxt, { color: c.primary }]}>Code: {code}</Text>
                    <TouchableOpacity onPress={() => setCodeStep(1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium" as const, color: c.mutedForeground }}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[s.cta, {
                  backgroundColor: (codeStep === 1 ? code.length === 5 : !!plate.trim()) ? c.primary : c.muted,
                  opacity: loading ? 0.7 : 1,
                }]}
                onPress={codeStep === 1 ? handleCodeNext : handleCodeRestore}
                disabled={loading || (codeStep === 1 ? code.length !== 5 : !plate.trim())}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Text style={s.ctaTxt}>{codeStep === 1 ? "Continue" : "Verify & Restore"}</Text>
                      <Ionicons name={codeStep === 1 ? "arrow-forward" : "shield-checkmark"} size={16} color="#fff" />
                    </>
                  )}
              </TouchableOpacity>
            </>
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
  tabs:       { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  tab:        { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  tabTxt:     { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  stepRow:    { flexDirection: "row", justifyContent: "center", gap: 36 },
  stepItem:   { alignItems: "center", gap: 6 },
  stepDot:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepLbl:    { fontSize: 11, fontFamily: "Inter_500Medium" },
  card:       { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  input:      { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 18, fontFamily: "Inter_600SemiBold" },
  otpInput:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 10 },
  codeInput:  { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 4 },
  chip:       { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  chipTxt:    { fontSize: 12, fontFamily: "Inter_700Bold" },
  cta:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
