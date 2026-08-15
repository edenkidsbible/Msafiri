/**
 * Restore Data screen — Email OTP recovery
 *
 * Enter recovery email → receive code via email → verify → data restored.
 * Replaces the old phone/SMS OTP flow.
 */
export { ErrorBoundary } from "@/components/ErrorBoundary";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { sendOtp, restoreViaEmail } from "@/utils/backupSync";
import { saveVehicles, setPrimaryVehicleIdIfUnset } from "@/utils/savedVehicles";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

export default function RestoreDataScreen() {
  const c = useColors();
  const { deviceId, setDriverName, setThemeOverride, setVehicleType } = useApp();
  const { refreshVehicles } = useVehicle();

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const bg      = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  // ── Step 1: Send OTP ────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!emailValid) {
      Alert.alert("Invalid email", "Enter a valid email address, e.g. you@example.com.");
      return;
    }
    setLoading(true);
    try {
      await sendOtp(normalizedEmail, "restore");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(2);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("No account") || msg.includes("not found")) {
        Alert.alert(
          "No account found",
          "We couldn't find a backup linked to that email. Make sure you're using the email you registered with on your previous device.",
        );
      } else if (msg.includes("Too many") || msg.includes("rate") || msg.includes("recently")) {
        Alert.alert("Too many requests", "Wait a few minutes and try again.");
      } else {
        Alert.alert("Failed to send code", msg || "Check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP ─────────────────────────────────────────────────────
  const handleVerify = async () => {
    const cleaned = otp.trim().replace(/\s/g, "");
    if (cleaned.length !== 6) {
      Alert.alert("Invalid code", "Enter the 6-digit code from your email.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app and try again.");
      return;
    }
    setLoading(true);
    try {
      const { vehicles, settings } = await restoreViaEmail(normalizedEmail, cleaned, deviceId);

      if (!vehicles || vehicles.length === 0) {
        Alert.alert("Nothing to restore", "No vehicle data was found for this account.");
        setLoading(false);
        return;
      }

      await saveVehicles(vehicles);
      if (vehicles[0]) await setPrimaryVehicleIdIfUnset(vehicles[0].id);
      await refreshVehicles();
      if (settings.driverName)    setDriverName(settings.driverName);
      if (settings.vehicleType)   setVehicleType(settings.vehicleType as any);
      if (settings.themeOverride) setThemeOverride(settings.themeOverride as any);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
      Alert.alert(
        "✅ Data Restored",
        `${vehicles.length} vehicle${vehicles.length !== 1 ? "s" : ""} and your settings have been restored. Welcome back!`,
        [{ text: "Done", onPress: () => router.replace("/(tabs)") }],
      );
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Invalid OTP") || msg.includes("expired") || msg.includes("not found")) {
        Alert.alert("Wrong or expired code", "Check the code and try again, or go back to request a new one.");
      } else if (msg.includes("Too many") || msg.includes("locked")) {
        Alert.alert("Too many attempts", "This code is locked. Go back and request a new one.");
      } else {
        Alert.alert("Restore failed", msg || "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: bg }]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
          <View style={[s.iconWrap, { backgroundColor: "#22C55E18" }]}>
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
          </View>
          <Text style={[s.heading, { color: c.foreground }]}>All Done!</Text>
          <Text style={[s.sub, { color: c.mutedForeground }]}>Your vehicles and settings have been restored.</Text>
        </View>
      </SafeAreaView>
    );
  }

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

      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

        <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
          <Ionicons name="shield-checkmark" size={38} color={c.primary} />
        </View>

        <Text style={[s.heading, { color: c.foreground }]}>
          {step === 1 ? "Enter your recovery email" : "Check your inbox"}
        </Text>
        <Text style={[s.sub, { color: c.mutedForeground }]}>
          {step === 1
            ? "We'll send a one-time code to the email address linked to your account."
            : `We sent a 6-digit code to ${normalizedEmail}. Check your inbox (and spam folder).`}
        </Text>

        {/* Step indicators */}
        <View style={s.stepRow}>
          {([1, 2] as const).map((n) => (
            <View key={n} style={s.stepItem}>
              <View style={[s.stepDot, { backgroundColor: step >= n ? c.primary : border }]}>
                {step > n
                  ? <Ionicons name="checkmark" size={14} color="#fff" />
                  : <Text style={[s.stepDotTxt, { color: step >= n ? "#fff" : c.mutedForeground }]}>{n}</Text>}
              </View>
              <Text style={[s.stepLbl, { color: step >= n ? c.primary : c.mutedForeground }]}>
                {n === 1 ? "Email address" : "Verify code"}
              </Text>
            </View>
          ))}
        </View>

        {/* Step 1: Email input */}
        {step === 1 && (
          <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>RECOVERY EMAIL ADDRESS</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={c.mutedForeground + "88"}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="send"
              onSubmitEditing={handleSend}
              style={[s.input, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
              autoFocus
            />
            <Text style={[s.hint, { color: c.mutedForeground }]}>
              Enter the email address you linked to your Msafiri account on your previous device.
            </Text>
          </View>
        )}

        {/* Step 2: OTP input */}
        {step === 2 && (
          <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>6-DIGIT CODE</Text>
              <TouchableOpacity onPress={() => { setStep(1); setOtp(""); }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.primary }}>Change email</Text>
              </TouchableOpacity>
            </View>
            <View style={[s.emailChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
              <Ionicons name="mail-outline" size={13} color={c.primary} />
              <Text style={[s.emailChipTxt, { color: c.primary }]} numberOfLines={1}>
                Sent to {normalizedEmail}
              </Text>
            </View>
            <TextInput
              value={otp}
              onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={c.mutedForeground + "88"}
              keyboardType="number-pad"
              maxLength={6}
              textContentType="none"
              autoComplete="off"
              style={[s.otpInput, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
              autoFocus
            />
            <Text style={[s.hint, { color: c.mutedForeground }]}>
              The code is valid for 10 minutes. Didn't receive it? Go back and try again.
            </Text>
          </View>
        )}

        {/* No-email fallback link — shown only on step 1 */}
        {step === 1 && (
          <TouchableOpacity
            onPress={() => router.push("/restore-by-plate")}
            activeOpacity={0.7}
            style={s.altLink}
          >
            <Ionicons name="car-outline" size={14} color={c.mutedForeground} />
            <Text style={[s.altLinkTxt, { color: c.mutedForeground }]}>
              Never linked an email? Recover with your plate number
            </Text>
          </TouchableOpacity>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[s.cta, {
            backgroundColor: step === 1
              ? (emailValid ? c.primary : c.muted)
              : (otp.length === 6 ? c.primary : c.muted),
            opacity: loading ? 0.7 : 1,
          }]}
          onPress={step === 1 ? handleSend : handleVerify}
          disabled={loading || (step === 1 ? !emailValid : otp.length !== 6)}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <Text style={s.ctaTxt}>{step === 1 ? "Send Code" : "Verify & Restore"}</Text>
                <Ionicons name={step === 1 ? "send-outline" : "shield-checkmark"} size={16} color="#fff" />
              </>
            )}
        </TouchableOpacity>

      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:       { flex: 1 },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn:      { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title:        { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  body:         { padding: 20, paddingBottom: 48, gap: 20 },
  iconWrap:     { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  heading:      { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub:          { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center" },
  stepRow:      { flexDirection: "row", justifyContent: "center", gap: 48 },
  stepItem:     { alignItems: "center", gap: 6 },
  stepDot:      { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotTxt:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepLbl:      { fontSize: 11, fontFamily: "Inter_500Medium" },
  card:         { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  fieldLabel:   { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  input:        { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, fontFamily: "Inter_400Regular" },
  otpInput:     { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 8 },
  hint:         { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  emailChip:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start", maxWidth: "100%" },
  emailChipTxt: { fontSize: 12, fontFamily: "Inter_700Bold", flexShrink: 1 },
  cta:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:       { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  altLink:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 4 },
  altLinkTxt:   { fontSize: 13, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
});
