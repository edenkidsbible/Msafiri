/**
 * Link Recovery Phone screen
 *
 * Used from Settings → Data & Recovery and from the onboarding phone slide.
 * Two-step flow:
 *   Step 1 — Enter Kenyan phone number → "Send Code"
 *   Step 2 — Enter the 6-digit OTP     → "Verify & Link"
 *
 * On success the phone is saved locally and the screen navigates back.
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
import { sendOtp, verifyAndLinkPhone } from "@/utils/backupSync";
import { displayKenyaPhone } from "@/utils/phoneUtils";

export default function LinkPhoneScreen() {
  const c        = useColors();
  const { deviceId } = useApp();

  const [step,    setStep]    = useState<1 | 2>(1);
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [linked,  setLinked]  = useState("");

  const bg      = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  // ── Step 1: send OTP ────────────────────────────────────────────────────────
  const handleSend = async () => {
    const clean = phone.trim();
    if (!clean) {
      Alert.alert("Phone required", "Enter your Kenyan mobile number.");
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

  // ── Step 2: verify OTP ──────────────────────────────────────────────────────
  const handleVerify = async () => {
    const cleanOtp = otp.trim().replace(/\s/g, "");
    if (cleanOtp.length !== 6) {
      Alert.alert("Invalid code", "Enter the 6-digit code sent to your phone.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app and try again.");
      return;
    }
    setLoading(true);
    try {
      const normalised = await verifyAndLinkPhone(phone.trim(), cleanOtp, deviceId);
      setLinked(normalised);
      setDone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => router.back(), 1800);
    } catch (err: any) {
      Alert.alert("Verification failed", err?.message ?? "Check the code and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[s.title, { color: c.foreground }]}>Link Recovery Phone</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={s.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Icon */}
          <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons
              name={done ? "checkmark-circle" : "phone-portrait-outline"}
              size={38}
              color={done ? "#22C55E" : c.primary}
            />
          </View>

          {done ? (
            <>
              <Text style={[s.heading, { color: c.foreground }]}>Phone Linked!</Text>
              <Text style={[s.sub, { color: c.mutedForeground }]}>
                {displayKenyaPhone(linked)} is now your recovery phone. You can restore your data on any new device using an SMS code.
              </Text>
            </>
          ) : (
            <>
              <Text style={[s.heading, { color: c.foreground }]}>
                {step === 1 ? "Enter your phone number" : "Enter the code"}
              </Text>
              <Text style={[s.sub, { color: c.mutedForeground }]}>
                {step === 1
                  ? "We'll send a 6-digit SMS code to verify it's yours. Standard SMS rates apply."
                  : `We sent a 6-digit code to ${phone.trim()}. Enter it below — it expires in 10 minutes.`}
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

              {/* Step 1: phone entry */}
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
                  <Text style={[s.hint, { color: c.mutedForeground }]}>
                    Enter any Kenyan number — Safaricom, Airtel, or Telkom.
                  </Text>
                </View>
              )}

              {/* Step 2: OTP entry */}
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
                  <View style={[s.phoneChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
                    <Ionicons name="phone-portrait-outline" size={13} color={c.primary} />
                    <Text style={[s.phoneChipTxt, { color: c.primary }]}>{phone.trim()}</Text>
                    <TouchableOpacity onPress={() => setStep(1)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium" as const, color: c.mutedForeground }}>Change</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* CTA */}
              <TouchableOpacity
                style={[
                  s.cta,
                  {
                    backgroundColor: (step === 1 ? phone.trim().length >= 9 : otp.length === 6)
                      ? c.primary : c.muted,
                    opacity: loading ? 0.7 : 1,
                  },
                ]}
                onPress={step === 1 ? handleSend : handleVerify}
                disabled={loading || (step === 1 ? phone.trim().length < 9 : otp.length !== 6)}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <Text style={s.ctaTxt}>{step === 1 ? "Send Code" : "Verify & Link"}</Text>
                      <Ionicons name={step === 1 ? "send" : "checkmark-circle"} size={16} color="#fff" />
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:      { flex: 1 },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title:       { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  body:        { padding: 20, paddingBottom: 48, gap: 20 },
  iconWrap:    { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  heading:     { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub:         { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center" },
  stepRow:     { flexDirection: "row", justifyContent: "center", gap: 36 },
  stepItem:    { alignItems: "center", gap: 6 },
  stepDot:     { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotTxt:  { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepLbl:     { fontSize: 11, fontFamily: "Inter_500Medium" },
  card:        { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  fieldLabel:  { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  input:       {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 18, fontFamily: "Inter_600SemiBold",
  },
  otpInput:    {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 28, fontFamily: "Inter_700Bold",
    textAlign: "center", letterSpacing: 10,
  },
  hint:        { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  phoneChip:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  phoneChipTxt:{ fontSize: 12, fontFamily: "Inter_700Bold" },
  cta:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
