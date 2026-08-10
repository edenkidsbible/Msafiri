export { ErrorBoundary } from "@/components/ErrorBoundary";
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
import { normalizeKenyaPhone, displayKenyaPhone } from "@/utils/phoneUtils";

export default function LinkPhoneScreen() {
  const c = useColors();
  const { deviceId } = useApp();

  const [step, setStep] = useState<1 | 2>(1);
  const [rawPhone, setRawPhone] = useState("");
  const [e164Phone, setE164Phone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const bg      = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  // ── Step 1: Send OTP ────────────────────────────────────────────────────────
  const handleSend = async () => {
    const normalized = normalizeKenyaPhone(rawPhone.trim());
    if (!normalized) {
      Alert.alert("Invalid number", "Enter a valid Kenyan phone number, e.g. 0712 345 678 or +254712345678.");
      return;
    }
    setLoading(true);
    try {
      const result = await sendOtp(normalized, "link");
      setE164Phone(normalized);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Dev-only: auto-fill OTP from server response so we can test without real SMS
      if (result?.devOtp) setOtp(String(result.devOtp));
      setStep(2);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("rate") || msg.includes("Too many")) {
        Alert.alert("Too many requests", "An OTP was already sent recently. Wait a few minutes and try again.");
      } else {
        Alert.alert("Failed to send OTP", msg || "Check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Verify OTP ─────────────────────────────────────────────────────
  const handleVerify = async () => {
    const cleaned = otp.trim().replace(/\s/g, "");
    if (cleaned.length !== 6) {
      Alert.alert("Invalid code", "Enter the 6-digit code we sent to your phone.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app and try again.");
      return;
    }
    setLoading(true);
    try {
      await verifyAndLinkPhone(e164Phone, cleaned, deviceId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccess(true);
      setTimeout(() => router.back(), 1800);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Invalid OTP") || msg.includes("expired") || msg.includes("not found")) {
        Alert.alert("Wrong or expired code", "Check the code and try again, or go back to request a new one.");
      } else if (msg.includes("Too many") || msg.includes("locked")) {
        Alert.alert("Too many attempts", "This OTP is locked after 5 wrong attempts. Request a new code.");
      } else {
        Alert.alert("Verification failed", msg || "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: bg }]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
          <View style={[s.iconWrap, { backgroundColor: "#22C55E18" }]}>
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
          </View>
          <Text style={[s.heading, { color: c.foreground }]}>Phone Linked!</Text>
          <Text style={[s.sub, { color: c.mutedForeground }]}>
            {displayKenyaPhone(e164Phone)} is now your recovery phone. Use it to restore your data on any new device.
          </Text>
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
        <Text style={[s.title, { color: c.foreground }]}>
          {step === 1 ? "Link Recovery Phone" : "Enter Verification Code"}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name={step === 1 ? "phone-portrait-outline" : "chatbubble-ellipses-outline"} size={36} color={c.primary} />
          </View>

          <Text style={[s.heading, { color: c.foreground }]}>
            {step === 1 ? "Add your phone number" : "Check your messages"}
          </Text>
          <Text style={[s.sub, { color: c.mutedForeground }]}>
            {step === 1
              ? "We'll send you a one-time code to verify this number. It will be used to recover your data if you change devices."
              : `We sent a 6-digit code to ${displayKenyaPhone(e164Phone)}. Enter it below.`}
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
                  {n === 1 ? "Phone number" : "Verify OTP"}
                </Text>
              </View>
            ))}
          </View>

          {/* Step 1: Phone input */}
          {step === 1 && (
            <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>PHONE NUMBER</Text>
              <TextInput
                value={rawPhone}
                onChangeText={setRawPhone}
                placeholder="+254 7XX XXX XXX"
                placeholderTextColor={c.mutedForeground + "88"}
                keyboardType="phone-pad"
                style={[s.input, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                autoFocus
              />
              <Text style={[s.hint, { color: c.mutedForeground }]}>
                Safaricom, Airtel, and Telkom numbers supported. Standard SMS rates may apply.
              </Text>
            </View>
          )}

          {/* Step 2: OTP input */}
          {step === 2 && (
            <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>6-DIGIT CODE</Text>
              <TextInput
                value={otp}
                onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                placeholderTextColor={c.mutedForeground + "88"}
                keyboardType="number-pad"
                maxLength={6}
                style={[s.otpInput, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                autoFocus
              />
              <TouchableOpacity onPress={() => { setStep(1); setOtp(""); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={[s.resend, { color: c.primary }]}>
                  Wrong number or didn't receive it? Go back →
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* CTA */}
          <TouchableOpacity
            style={[s.cta, {
              backgroundColor: step === 1
                ? (rawPhone.trim().length >= 9 ? c.primary : c.muted)
                : (otp.length === 6 ? c.primary : c.muted),
              opacity: loading ? 0.7 : 1,
            }]}
            onPress={step === 1 ? handleSend : handleVerify}
            disabled={loading || (step === 1 ? rawPhone.trim().length < 9 : otp.length !== 6)}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <>
                  <Text style={s.ctaTxt}>{step === 1 ? "Send Code" : "Verify & Link"}</Text>
                  <Ionicons name={step === 1 ? "send-outline" : "checkmark-circle-outline"} size={16} color="#fff" />
                </>
              )}
          </TouchableOpacity>
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
  stepRow:    { flexDirection: "row", justifyContent: "center", gap: 48 },
  stepItem:   { alignItems: "center", gap: 6 },
  stepDot:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotTxt: { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepLbl:    { fontSize: 11, fontFamily: "Inter_500Medium" },
  card:       { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  input:      { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, fontFamily: "Inter_400Regular" },
  otpInput:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 8 },
  hint:       { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, color: "#7A8C7A" },
  resend:     { fontSize: 13, fontFamily: "Inter_500Medium" },
  cta:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:     { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
