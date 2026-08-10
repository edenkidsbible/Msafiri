/**
 * Restore Data screen
 *
 * Two recovery paths:
 *   Primary  — Phone OTP: enter phone → receive SMS code → restore
 *   Fallback — Recovery code: enter 5-char code + plate number (legacy)
 */
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
import { useVehicle } from "@/context/VehicleContext";
import {
  sendOtp, restoreViaPhone,
  verifyAndRestore,
} from "@/utils/backupSync";
import { saveVehicles, setPrimaryVehicleIdIfUnset } from "@/utils/savedVehicles";
import { normalizeKenyaPhone, displayKenyaPhone } from "@/utils/phoneUtils";

// ── Shared helpers ────────────────────────────────────────────────────────────

type Tab = "phone" | "code";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const c = useColors();
  return (
    <View style={[tb.wrap, { backgroundColor: c.muted, borderColor: c.border }]}>
      {(["phone", "code"] as Tab[]).map((t) => (
        <TouchableOpacity
          key={t}
          style={[tb.tab, active === t && { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => onChange(t)}
          activeOpacity={0.75}
        >
          <Ionicons
            name={t === "phone" ? "phone-portrait-outline" : "key-outline"}
            size={14}
            color={active === t ? c.foreground : c.mutedForeground}
          />
          <Text style={[tb.label, { color: active === t ? c.foreground : c.mutedForeground }]}>
            {t === "phone" ? "Phone OTP" : "Recovery Code"}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const tb = StyleSheet.create({
  wrap:  { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 3, marginBottom: 4 },
  tab:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: "transparent" },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ── Phone OTP flow ────────────────────────────────────────────────────────────

function PhoneRestoreFlow({
  deviceId,
  onSuccess,
}: {
  deviceId: string | undefined;
  onSuccess: (vehicles: any[], settings: any) => void;
}) {
  const c = useColors();
  const bg      = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  const [step, setStep] = useState<1 | 2>(1);
  const [rawPhone, setRawPhone] = useState("");
  const [e164, setE164] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    const normalized = normalizeKenyaPhone(rawPhone.trim());
    if (!normalized) {
      Alert.alert("Invalid number", "Enter a valid Kenyan number, e.g. 0712 345 678 or +254712345678.");
      return;
    }
    setLoading(true);
    try {
      await sendOtp(normalized, "restore");
      setE164(normalized);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(2);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found") || msg.includes("404")) {
        Alert.alert("No account found", "We couldn't find a backup linked to that number. Try a different number or use your recovery code below.");
      } else if (msg.includes("rate") || msg.includes("429")) {
        Alert.alert("Too many requests", "Wait a few minutes and try again.");
      } else {
        Alert.alert("Failed to send OTP", "Check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    const cleaned = otp.trim().replace(/\s/g, "");
    if (cleaned.length !== 6) {
      Alert.alert("Invalid code", "Enter the 6-digit code we texted you.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app and try again.");
      return;
    }
    setLoading(true);
    try {
      const { vehicles, settings } = await restoreViaPhone(e164, cleaned, deviceId);
      onSuccess(vehicles, settings);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Invalid") || msg.includes("expired") || msg.includes("401")) {
        Alert.alert("Wrong or expired code", "Check the code and try again, or go back to request a new one.");
      } else if (msg.includes("locked") || msg.includes("429")) {
        Alert.alert("Too many attempts", "This code is locked. Go back and request a new one.");
      } else {
        Alert.alert("Restore failed", "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
        {step === 1 ? (
          <>
            <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>RECOVERY PHONE NUMBER</Text>
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
              Enter the phone number you linked to your Msafiri account on the old device.
            </Text>
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>6-DIGIT CODE</Text>
              <TouchableOpacity onPress={() => { setStep(1); setOtp(""); }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.primary }}>Change number</Text>
              </TouchableOpacity>
            </View>
            <View style={[s.phoneChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
              <Ionicons name="phone-portrait-outline" size={13} color={c.primary} />
              <Text style={[s.phoneChipTxt, { color: c.primary }]}>Sent to {displayKenyaPhone(e164)}</Text>
            </View>
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
            <Text style={[s.hint, { color: c.mutedForeground }]}>
              The code is valid for 10 minutes. Check SMS or try again if it doesn't arrive.
            </Text>
          </>
        )}
      </View>

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
              <Text style={s.ctaTxt}>{step === 1 ? "Send Code" : "Verify & Restore"}</Text>
              <Ionicons name={step === 1 ? "send-outline" : "shield-checkmark"} size={16} color="#fff" />
            </>
          )}
      </TouchableOpacity>
    </View>
  );
}

// ── Recovery code (legacy) flow ───────────────────────────────────────────────

function CodeRestoreFlow({
  deviceId,
  onSuccess,
}: {
  deviceId: string | undefined;
  onSuccess: (vehicles: any[], settings: any) => void;
}) {
  const c = useColors();
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState("");
  const [plate, setPlate] = useState("");
  const [loading, setLoading] = useState(false);

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

  const handleRestore = async () => {
    const cleanPlate = plate.trim();
    if (!cleanPlate) {
      Alert.alert("Plate required", "Enter at least one plate number from any vehicle in the account.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app.");
      return;
    }
    setLoading(true);
    try {
      const { vehicles, settings } = await verifyAndRestore(code, cleanPlate, deviceId);
      onSuccess(vehicles, settings);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("not found") || msg.toLowerCase().includes("404")) {
        Alert.alert("Code not found", "We couldn't find an account with that recovery code. Double-check the code and try again.");
      } else if (msg.includes("Plate") || msg.toLowerCase().includes("403")) {
        Alert.alert("Plate doesn't match", "The plate entered doesn't match any vehicle in that account.");
      } else {
        Alert.alert("Restore failed", "Check your internet connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={[s.card, { backgroundColor: cardBg, borderColor: border }]}>
        {step === 1 ? (
          <>
            <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>RECOVERY CODE</Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="e.g. A7K2M"
              placeholderTextColor={c.mutedForeground + "88"}
              autoCapitalize="characters"
              maxLength={5}
              style={[s.codeInput, { backgroundColor: inputBg, borderColor: border, color: c.mutedForeground }]}
              autoFocus
            />
            <Text style={[s.hint, { color: c.mutedForeground }]}>
              The 5-character code from Settings → Data & Recovery on your previous device.
            </Text>
          </>
        ) : (
          <>
            <Text style={[s.fieldLabel, { color: c.mutedForeground }]}>NUMBER PLATE</Text>
            <TextInput
              value={plate}
              onChangeText={(t) => setPlate(t.toUpperCase())}
              placeholder="e.g. KCB 123A"
              placeholderTextColor={c.mutedForeground + "88"}
              autoCapitalize="characters"
              style={[s.input, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
              autoFocus
            />
            <Text style={[s.hint, { color: c.mutedForeground }]}>
              Any plate from any vehicle in the account works.
            </Text>
            <TouchableOpacity
              style={[s.codeChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}
              onPress={() => setStep(1)}
            >
              <Ionicons name="key-outline" size={13} color={c.primary} />
              <Text style={[s.codeChipTxt, { color: c.primary }]}>Code: {code}</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium" as const, color: c.mutedForeground }}> — Change</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity
        style={[s.cta, {
          backgroundColor: (step === 1 ? code.length === 5 : !!plate.trim()) ? c.primary : c.muted,
          opacity: loading ? 0.7 : 1,
        }]}
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
    </View>
  );
}

// ── Root screen ───────────────────────────────────────────────────────────────

export default function RestoreDataScreen() {
  const c = useColors();
  const { deviceId, setDriverName, setThemeOverride, setVehicleType } = useApp();
  const { refreshVehicles } = useVehicle();
  const [tab, setTab] = useState<Tab>("phone");
  const [done, setDone] = useState(false);

  const bg = c.isDark ? "#0D1611" : "#F6FAF7";

  const handleSuccess = async (vehicles: any[], settings: any) => {
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
    setDone(true);
    Alert.alert(
      "✅ Data Restored",
      `${vehicles.length} vehicle${vehicles.length !== 1 ? "s" : ""} and your settings have been restored. Welcome back!`,
      [{ text: "Done", onPress: () => router.replace("/(tabs)") }],
    );
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

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={[s.iconWrap, { backgroundColor: c.primary + "18" }]}>
            <Ionicons name="shield-checkmark" size={38} color={c.primary} />
          </View>

          <Text style={[s.heading, { color: c.foreground }]}>Recover your account</Text>
          <Text style={[s.sub, { color: c.mutedForeground }]}>
            Use your linked phone number for the fastest recovery. The recovery code option is for older accounts.
          </Text>

          <TabBar active={tab} onChange={setTab} />

          {tab === "phone"
            ? <PhoneRestoreFlow deviceId={deviceId} onSuccess={handleSuccess} />
            : <CodeRestoreFlow  deviceId={deviceId} onSuccess={handleSuccess} />}

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
  card:        { borderRadius: 18, borderWidth: 1, padding: 20, gap: 12 },
  fieldLabel:  { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  input:       { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, fontFamily: "Inter_400Regular" },
  otpInput:    { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 8 },
  codeInput:   { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 6 },
  hint:        { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  phoneChip:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  phoneChipTxt:{ fontSize: 12, fontFamily: "Inter_700Bold" },
  codeChip:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  codeChipTxt: { fontSize: 12, fontFamily: "Inter_700Bold" },
  cta:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
});
