/**
 * Restore-by-Plate screen — knowledge-based recovery for existing users
 * who never registered a recovery email.
 *
 * Flow:
 *   Step 1 — Enter plate + vehicle details (type, fuel, transmission)
 *   Step 2 — Add a recovery email (send OTP) — mandatory to prevent re-lockout
 *   Step 3 — Verify the emailed code
 *   Done   — vehicles restored, email linked
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
import {
  restoreByPlate,
  sendOtp,
  verifyAndLinkEmail,
} from "@/utils/backupSync";
import { saveVehicles, setPrimaryVehicleIdIfUnset, normalizePlate } from "@/utils/savedVehicles";
import { VEHICLE_TYPES } from "@/data/vehicleTypes";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

// ── Option lists ──────────────────────────────────────────────────────────────

const FUEL_OPTIONS = [
  { value: "Petrol",   label: "⛽ Petrol" },
  { value: "Diesel",   label: "🛢️ Diesel" },
  { value: "Electric", label: "⚡ Electric" },
  { value: "Hybrid",   label: "🔋 Hybrid" },
  { value: "CNG",      label: "💨 CNG" },
] as const;

const TRANS_OPTIONS = [
  { value: "Automatic", label: "🔄 Automatic" },
  { value: "Manual",    label: "🕹️ Manual" },
] as const;

type Step = 1 | 2 | 3;

// ── Chip select component ─────────────────────────────────────────────────────

function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | "";
  onChange: (v: T) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const border = colors.isDark ? "#1E2E22" : "#E3EDE5";
  return (
    <View style={{ gap: 8 }}>
      <Text style={[cs.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onChange(opt.value)}
              activeOpacity={0.75}
              style={[
                cs.chip,
                {
                  backgroundColor: active ? colors.primary + "18" : colors.isDark ? "#1A2820" : "#F0F6F1",
                  borderColor: active ? colors.primary : border,
                },
              ]}
            >
              <Text style={[cs.chipTxt, { color: active ? colors.primary : colors.foreground }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RestoreByPlateScreen() {
  const c = useColors();
  const {
    deviceId,
    driverName,
    vehicleType,
    themeOverride,
    setDriverName,
    setThemeOverride,
    setVehicleType,
  } = useApp();
  const { refreshVehicles } = useVehicle();

  const [step, setStep] = useState<Step>(1);

  // Step 1 fields
  const [plate, setPlate]           = useState("");
  const [vehType, setVehType]       = useState<string>("");
  const [fuelType, setFuelType]     = useState<string>("");
  const [transmission, setTrans]    = useState<string>("");

  // Step 2–3 fields (email OTP)
  const [email, setEmail]           = useState("");
  const [otp, setOtp]               = useState("");

  const [loading, setLoading]       = useState(false);
  const [done, setDone]             = useState(false);

  const bg      = c.isDark ? "#0D1611" : "#F6FAF7";
  const cardBg  = c.isDark ? "#131F17" : "#fff";
  const border  = c.isDark ? "#1E2E22" : "#E3EDE5";
  const inputBg = c.isDark ? "#1A2820" : "#F0F6F1";

  const normalizedPlate = normalizePlate(plate);
  const normalizedEmail = email.trim().toLowerCase();
  const emailValid      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  const step1Ready = normalizedPlate.length >= 3 && !!vehType;

  // ── Step 1: Verify plate + details ────────────────────────────────────────
  const handleVerify = async () => {
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app and try again.");
      return;
    }
    setLoading(true);
    try {
      const { vehicles, settings } = await restoreByPlate(
        normalizedPlate,
        vehType,
        fuelType || undefined,
        transmission || undefined,
        deviceId,
      );

      if (!vehicles || vehicles.length === 0) {
        Alert.alert("Nothing to restore", "No vehicle data was found matching those details.");
        return;
      }

      await saveVehicles(vehicles as any);
      if (vehicles[0]) await setPrimaryVehicleIdIfUnset((vehicles[0] as any).id);
      await refreshVehicles();
      if ((settings as any).driverName)    setDriverName((settings as any).driverName);
      if ((settings as any).vehicleType)   setVehicleType((settings as any).vehicleType);
      if ((settings as any).themeOverride) setThemeOverride((settings as any).themeOverride);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Move to email-link step
      setStep(2);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      const status = err?.status ?? err?.statusCode ?? 0;

      if (status === 429 || msg.includes("Too many") || msg.includes("rate")) {
        Alert.alert("Too many attempts", "Wait 15 minutes before trying again.");
      } else if (status === 409 || msg.includes("recovery email")) {
        Alert.alert(
          "Email on file",
          "This account already has a recovery email. Go back and use 'Restore via Email' instead.",
          [{ text: "Go back", onPress: () => router.back() }],
        );
      } else if (status === 422 || msg.includes("enough verification")) {
        Alert.alert(
          "Not enough details on file",
          "Your original account didn't have fuel type or transmission saved. Please submit a claim — our team will help you.",
        );
      } else if (status === 403 || msg.includes("don't match")) {
        Alert.alert(
          "Details don't match",
          "The vehicle details you entered don't match what's on file. Double-check your plate number and vehicle details.",
        );
      } else if (status === 404 || msg.includes("No account")) {
        Alert.alert(
          "No account found",
          "We couldn't find a backup for that plate number. Make sure you're entering the plate exactly as registered.",
        );
      } else {
        Alert.alert("Restore failed", msg || "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Send email link OTP ───────────────────────────────────────────
  const handleSendEmail = async () => {
    if (!emailValid) {
      Alert.alert("Invalid email", "Enter a valid email address, e.g. you@example.com.");
      return;
    }
    if (!deviceId) {
      Alert.alert("Error", "Device ID unavailable. Restart the app and try again.");
      return;
    }
    setLoading(true);
    try {
      await sendOtp(normalizedEmail, "link", deviceId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(3);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Too many") || msg.includes("recently")) {
        Alert.alert("Too many requests", "Wait a few minutes before trying again.");
      } else {
        Alert.alert("Failed to send code", msg || "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Verify email OTP ──────────────────────────────────────────────
  const handleVerifyEmail = async () => {
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
      await verifyAndLinkEmail(normalizedEmail, cleaned, deviceId, {
        driverName,
        vehicleType,
        themeOverride,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(true);
      Alert.alert(
        "✅ All Done!",
        "Your data has been restored and your recovery email is now linked. Welcome back!",
        [{ text: "Done", onPress: () => router.replace("/(tabs)") }],
      );
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Code expired") || msg.includes("expired") || msg.includes("not found")) {
        Alert.alert("Code expired", "This code is no longer valid. Go back and request a new one.");
      } else if (msg.includes("Wrong code") || msg.includes("Invalid")) {
        Alert.alert("Wrong code", "That code doesn't match. Double-check the digits and try again.");
      } else if (msg.includes("Too many") || msg.includes("locked")) {
        Alert.alert("Too many attempts", "This code is locked. Go back and request a new one.");
      } else {
        Alert.alert("Verification failed", msg || "Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Skip email ────────────────────────────────────────────────────────────
  const handleSkipEmail = () => {
    Alert.alert(
      "Skip email?",
      "Without a recovery email, you won't be able to restore your data if you reinstall again. Are you sure?",
      [
        { text: "Add email", style: "cancel" },
        {
          text: "Skip for now",
          onPress: () => router.replace("/(tabs)"),
        },
      ],
    );
  };

  // ── Step labels ───────────────────────────────────────────────────────────
  const STEPS = ["Vehicle details", "Recovery email", "Verify code"] as const;

  // ── Done state ────────────────────────────────────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={[cs.screen, { backgroundColor: bg }]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
          <View style={[cs.iconWrap, { backgroundColor: "#22C55E18" }]}>
            <Ionicons name="checkmark-circle" size={48} color="#22C55E" />
          </View>
          <Text style={[cs.heading, { color: c.foreground }]}>All Done!</Text>
          <Text style={[cs.sub, { color: c.mutedForeground }]}>
            Your vehicles and settings have been restored and your email is linked.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[cs.screen, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={cs.header}>
        <TouchableOpacity
          onPress={() => (step > 1 ? setStep((s) => (s - 1) as Step) : router.back())}
          style={cs.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[cs.title, { color: c.foreground }]}>Recover with Plate</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAwareScrollViewCompat style={{ flex: 1 }} contentContainerStyle={cs.body} showsVerticalScrollIndicator={false}>

        <View style={[cs.iconWrap, { backgroundColor: c.primary + "18" }]}>
          <Ionicons name={step === 1 ? "car-outline" : "mail-outline"} size={38} color={c.primary} />
        </View>

        <Text style={[cs.heading, { color: c.foreground }]}>
          {step === 1
            ? "Confirm your vehicle details"
            : step === 2
              ? "Add a recovery email"
              : "Check your inbox"}
        </Text>
        <Text style={[cs.sub, { color: c.mutedForeground }]}>
          {step === 1
            ? "Enter your number plate and the details you used when setting up the app. They must match exactly."
            : step === 2
              ? "Your data is restored! Now add an email so you can recover easily next time — without going through this."
              : `We sent a 6-digit code to ${normalizedEmail}. Enter it below to link your email.`}
        </Text>

        {/* Step indicators */}
        <View style={cs.stepRow}>
          {STEPS.map((lbl, i) => {
            const n = (i + 1) as Step;
            return (
              <View key={lbl} style={cs.stepItem}>
                <View style={[cs.stepDot, { backgroundColor: step >= n ? c.primary : border }]}>
                  {step > n
                    ? <Ionicons name="checkmark" size={14} color="#fff" />
                    : <Text style={[cs.stepDotTxt, { color: step >= n ? "#fff" : c.mutedForeground }]}>{n}</Text>}
                </View>
                <Text style={[cs.stepLbl, { color: step >= n ? c.primary : c.mutedForeground }]} numberOfLines={1}>
                  {lbl}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Step 1: Plate + vehicle details ─────────────────────────────── */}
        {step === 1 && (
          <View style={[cs.card, { backgroundColor: cardBg, borderColor: border }]}>

            {/* Plate */}
            <View style={{ gap: 8 }}>
              <Text style={[cs.fieldLabel, { color: c.mutedForeground }]}>NUMBER PLATE</Text>
              <TextInput
                value={plate}
                onChangeText={setPlate}
                placeholder="e.g. KDA 123A"
                placeholderTextColor={c.mutedForeground + "88"}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
                style={[cs.input, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
                autoFocus
              />
              {plate.length >= 3 && (
                <Text style={[cs.hint, { color: c.mutedForeground }]}>
                  Will search as: <Text style={{ fontFamily: "Inter_700Bold" }}>{normalizedPlate}</Text>
                </Text>
              )}
            </View>

            {/* Vehicle type */}
            <ChipSelect
              label="VEHICLE TYPE"
              options={VEHICLE_TYPES.map((vt) => ({ value: vt.id, label: vt.shortLabel }))}
              value={vehType}
              onChange={setVehType}
              colors={c}
            />

            {/* Fuel type */}
            <ChipSelect
              label="FUEL TYPE (if you set it)"
              options={FUEL_OPTIONS}
              value={fuelType}
              onChange={setFuelType}
              colors={c}
            />

            {/* Transmission */}
            <ChipSelect
              label="TRANSMISSION (if you set it)"
              options={TRANS_OPTIONS}
              value={transmission}
              onChange={setTrans}
              colors={c}
            />

            <Text style={[cs.hint, { color: c.mutedForeground, marginTop: 4 }]}>
              At least one of fuel type or transmission must match what you entered when you first set up the app.
            </Text>
          </View>
        )}

        {/* ── Step 2: Enter email ──────────────────────────────────────────── */}
        {step === 2 && (
          <View style={[cs.card, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={[cs.successBanner, { backgroundColor: "#22C55E12", borderColor: "#22C55E33" }]}>
              <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
              <Text style={[cs.successTxt, { color: "#22C55E" }]}>Data restored successfully</Text>
            </View>
            <Text style={[cs.fieldLabel, { color: c.mutedForeground }]}>RECOVERY EMAIL ADDRESS</Text>
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
              onSubmitEditing={handleSendEmail}
              style={[cs.input, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
              autoFocus
            />
            <Text style={[cs.hint, { color: c.mutedForeground }]}>
              This email will be used to restore your data if you reinstall the app. We won't use it for marketing.
            </Text>
          </View>
        )}

        {/* ── Step 3: Verify email OTP ─────────────────────────────────────── */}
        {step === 3 && (
          <View style={[cs.card, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[cs.fieldLabel, { color: c.mutedForeground }]}>6-DIGIT CODE</Text>
              <TouchableOpacity onPress={() => { setStep(2); setOtp(""); }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: c.primary }}>Change email</Text>
              </TouchableOpacity>
            </View>
            <View style={[cs.emailChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "33" }]}>
              <Ionicons name="mail-outline" size={13} color={c.primary} />
              <Text style={[cs.emailChipTxt, { color: c.primary }]} numberOfLines={1}>
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
              style={[cs.otpInput, { backgroundColor: inputBg, borderColor: border, color: c.foreground }]}
              autoFocus
            />
            <Text style={[cs.hint, { color: c.mutedForeground }]}>
              The code is valid for 10 minutes. Didn't receive it? Go back to re-enter your email.
            </Text>
          </View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[cs.cta, {
            backgroundColor:
              step === 1 ? (step1Ready ? c.primary : c.muted)
              : step === 2 ? (emailValid ? c.primary : c.muted)
              : (otp.length === 6 ? c.primary : c.muted),
            opacity: loading ? 0.7 : 1,
          }]}
          onPress={step === 1 ? handleVerify : step === 2 ? handleSendEmail : handleVerifyEmail}
          disabled={
            loading ||
            (step === 1 ? !step1Ready
            : step === 2 ? !emailValid
            : otp.length !== 6)
          }
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : (
              <>
                <Text style={cs.ctaTxt}>
                  {step === 1 ? "Verify & Restore"
                  : step === 2 ? "Send Code"
                  : "Link Email & Finish"}
                </Text>
                <Ionicons
                  name={step === 1 ? "shield-checkmark" : step === 2 ? "send-outline" : "checkmark-circle"}
                  size={16}
                  color="#fff"
                />
              </>
            )}
        </TouchableOpacity>

        {/* Skip email link (steps 2 & 3 only) */}
        {step >= 2 && (
          <TouchableOpacity onPress={handleSkipEmail} activeOpacity={0.7} style={{ alignItems: "center" }}>
            <Text style={[cs.skipTxt, { color: c.mutedForeground }]}>
              Skip for now — add email later in settings
            </Text>
          </TouchableOpacity>
        )}

      </KeyboardAwareScrollViewCompat>
    </SafeAreaView>
  );
}

const cs = StyleSheet.create({
  screen:       { flex: 1 },
  header:       { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  backBtn:      { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title:        { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  body:         { padding: 20, paddingBottom: 48, gap: 20 },
  iconWrap:     { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  heading:      { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub:          { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, textAlign: "center" },
  stepRow:      { flexDirection: "row", justifyContent: "center", gap: 32 },
  stepItem:     { alignItems: "center", gap: 6, maxWidth: 80 },
  stepDot:      { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDotTxt:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  stepLbl:      { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
  card:         { borderRadius: 18, borderWidth: 1, padding: 20, gap: 16 },
  fieldLabel:   { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  input:        { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, fontFamily: "Inter_400Regular" },
  otpInput:     { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: 8 },
  hint:         { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  chipTxt:      { fontSize: 13, fontFamily: "Inter_500Medium" },
  emailChip:    { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start", maxWidth: "100%" },
  emailChipTxt: { fontSize: 12, fontFamily: "Inter_700Bold", flexShrink: 1 },
  successBanner:{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  successTxt:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  cta:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 16 },
  ctaTxt:       { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  skipTxt:      { fontSize: 13, fontFamily: "Inter_400Regular", textDecorationLine: "underline" },
});
