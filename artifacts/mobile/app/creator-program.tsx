import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Purchases from "react-native-purchases";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { SCROLL_PROPS } from "@/lib/scrollProps";
import { apiPost, apiGet } from "@/utils/apiClient";

const STORAGE_KEY = "creator_application_submitted";

const PERKS = [
  { icon: "gift-outline",    text: "1 month free Msafiri Pro subscription" },
  { icon: "map-outline",     text: "Help make Kenya's roads safer for everyone" },
  { icon: "trending-up-outline", text: "Your reports shape the live map other drivers rely on" },
];

const DUTIES = [
  { icon: "speedometer-outline", text: "Report speed cameras and their exact locations" },
  { icon: "warning-outline",     text: "Flag police checkpoints and road hazards" },
  { icon: "construct-outline",   text: "Report potholes, roadworks, and accidents" },
  { icon: "thumbs-up-outline",   text: "Confirm or deny existing community reports" },
];

type SubmitState = "idle" | "submitting" | "success" | "already";

export default function CreatorProgramScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [reason, setReason]     = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val) setSubmitState("already");
    });
  }, []);

  async function handleSubmit() {
    if (!email.trim()) {
      setError("Please enter your email so we can send you the promo code.");
      return;
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!emailOk) {
      setError("Please enter a valid email address.");
      return;
    }
    setError(null);
    setSubmitState("submitting");
    try {
      const deviceId = await AsyncStorage.getItem("device_id") ?? "unknown";
      const result = await apiPost("/creator-application", {
        deviceId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        reason: reason.trim() || null,
      });
      await AsyncStorage.setItem(STORAGE_KEY, "true");
      if ((result as any).alreadyApplied) {
        setSubmitState("already");
      } else {
        setSubmitState("success");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitState("idle");
    }
  }

  async function handleRedeemCode() {
    if (Platform.OS === "ios") {
      try {
        await (Purchases as any).presentCodeRedemptionSheet();
      } catch {
        Linking.openURL("https://apps.apple.com/redeem");
      }
    } else {
      Linking.openURL("https://play.google.com/redeem");
    }
  }

  const showForm    = submitState === "idle" || submitState === "submitting";
  const showSuccess = submitState === "success" || submitState === "already";

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderBottomColor: c.border, paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Msafiri Creators</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        {...SCROLL_PROPS}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.heroBadge, { backgroundColor: c.primary + "18" }]}>
          <Ionicons name="star" size={36} color={c.primary} />
        </View>
        <Text style={[styles.heroTitle, { color: c.foreground }]}>Become a Msafiri Creator</Text>
        <Text style={[styles.heroSub, { color: c.mutedForeground }]}>
          Help keep Kenyan roads safer. Report speed cameras, hazards, and incidents — and get your first month on us.
        </Text>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>What you get</Text>
          {PERKS.map((p) => (
            <View key={p.text} style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: c.primary + "18" }]}>
                <Ionicons name={p.icon as any} size={16} color={c.primary} />
              </View>
              <Text style={[styles.rowText, { color: c.foreground }]}>{p.text}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>What you do</Text>
          {DUTIES.map((d) => (
            <View key={d.text} style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: c.mutedForeground + "18" }]}>
                <Ionicons name={d.icon as any} size={16} color={c.mutedForeground} />
              </View>
              <Text style={[styles.rowText, { color: c.mutedForeground }]}>{d.text}</Text>
            </View>
          ))}
        </View>

        {showForm && (
          <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionTitle, { color: c.foreground }]}>Apply to join</Text>

            <Text style={[styles.label, { color: c.mutedForeground }]}>Name (optional)</Text>
            <TextInput
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.background }]}
              placeholder="Your name"
              placeholderTextColor={c.mutedForeground}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>Email *</Text>
            <TextInput
              style={[styles.input, { borderColor: c.border, color: c.foreground, backgroundColor: c.background }]}
              placeholder="you@example.com"
              placeholderTextColor={c.mutedForeground}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>Why do you want to be a creator? (optional)</Text>
            <TextInput
              style={[styles.input, styles.textarea, { borderColor: c.border, color: c.foreground, backgroundColor: c.background }]}
              placeholder="Tell us a bit about yourself and where you drive..."
              placeholderTextColor={c.mutedForeground}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: c.primary, opacity: submitState === "submitting" ? 0.6 : 1 }]}
              onPress={handleSubmit}
              disabled={submitState === "submitting"}
              activeOpacity={0.85}
            >
              {submitState === "submitting" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnTxt}>Apply Now</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {showSuccess && (
          <View style={[styles.successBox, { backgroundColor: c.primary + "12", borderColor: c.primary + "40" }]}>
            <Ionicons name="checkmark-circle" size={36} color={c.primary} />
            <Text style={[styles.successTitle, { color: c.foreground }]}>
              {submitState === "already" ? "Application received!" : "You're in!"}
            </Text>
            <Text style={[styles.successBody, { color: c.mutedForeground }]}>
              We'll review your application and send your promo code within 24 hours. Once you receive it, tap below to redeem.
            </Text>
          </View>
        )}

        <View style={[styles.codeBox, { borderColor: c.border, backgroundColor: c.card }]}>
          <Text style={[styles.codeTitle, { color: c.foreground }]}>Already have a promo code?</Text>
          <Text style={[styles.codeBody, { color: c.mutedForeground }]}>
            {Platform.OS === "ios"
              ? "Tap below to open Apple's code redemption sheet and enter your code."
              : "Tap below to open Google Play and enter your promo code."}
          </Text>
          <TouchableOpacity
            style={[styles.codeBtn, { borderColor: c.primary }]}
            onPress={handleRedeemCode}
            activeOpacity={0.8}
          >
            <Ionicons name="pricetag-outline" size={16} color={c.primary} />
            <Text style={[styles.codeBtnTxt, { color: c.primary }]}>Redeem Promo Code</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  scroll: { padding: 20, gap: 16 },

  heroBadge: {
    width: 72, height: 72, borderRadius: 22,
    alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 4,
  },
  heroTitle: { fontSize: 24, fontFamily: "Inter_700Bold", textAlign: "center" },
  heroSub:   { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginTop: 6 },

  section: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },

  row:      { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  rowText:  { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },

  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4, marginTop: 4 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular",
  },
  textarea: { height: 80, textAlignVertical: "top", paddingTop: 10 },
  errorText: { color: "#E53935", fontSize: 12, fontFamily: "Inter_400Regular" },

  submitBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  submitBtnTxt: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },

  successBox: {
    borderRadius: 16, borderWidth: 1, padding: 20,
    alignItems: "center", gap: 8,
  },
  successTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  successBody:  { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  codeBox: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  codeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  codeBody:  { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  codeBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
    alignSelf: "flex-start",
  },
  codeBtnTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
