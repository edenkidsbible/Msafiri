import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useApp } from "@/context/AppContext";

const GREEN    = "#00A845";
const FLAG_RED = "#BB0000";
const SCREEN_BG = "#EDF7F2";

/** Strip everything that isn't a plain ASCII letter */
const lettersOnly = (s: string) => s.replace(/[^a-zA-Z]/g, "");

/** First letter uppercase, rest lowercase */
const capitalize = (s: string) =>
  s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();

export default function OnboardingNameScreen() {
  const insets = useSafeAreaInsets();
  const { setDriverName } = useApp();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isExisting = mode === "existing";

  const [raw, setRaw] = useState("");
  const isValid = raw.length >= 2;

  const handleContinue = () => {
    if (!isValid) return;
    const name = capitalize(raw);
    setDriverName(name);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The first-time path still receives the free driving allowance. Existing
    // users are already fully set up and can return to the tab navigator.
    router.replace(isExisting ? "/(tabs)" : "/vehicle-setup");
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* ── Brand header (matches onboarding.tsx) ── */}
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <View style={styles.brandRow}>
          <Image source={require("@/assets/images/icon.png")} style={styles.brandIcon} />
          <Text style={styles.brandName}>
            Msafiri<Text style={styles.brandKenya}> Kenya</Text>
          </Text>
        </View>
        <View style={[styles.headerSide, { alignItems: "flex-end" }]}>
          {isExisting && (
            <TouchableOpacity
              onPress={() => router.replace("/(tabs)")}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
            >
              <Text style={styles.skipTxt}>Skip</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.body}>
          {/* Hero */}
          <View style={styles.heroWrap}>
            <Text style={styles.heroEmoji}>👋</Text>
          </View>

          <Text style={styles.headline}>
            What's your{"\n"}first name?
          </Text>
          <Text style={styles.sub}>
            Used to personalise your experience{"\n"}and notifications from other drivers.
          </Text>

          <View style={styles.inputWrap}>
            <TextInput
              style={[styles.input, isValid && styles.inputValid]}
              value={raw}
              onChangeText={(t) => setRaw(lettersOnly(t))}
              placeholder="e.g. Peter"
              placeholderTextColor="#A0B5A0"
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
            />
            {/* Live preview of how the name will be saved */}
            {isValid && (
              <View style={styles.previewRow}>
                <Ionicons name="checkmark-circle" size={15} color={GREEN} />
                <Text style={styles.previewText}>
                  Will be saved as{" "}
                  <Text style={styles.previewName}>{capitalize(raw)}</Text>
                </Text>
              </View>
            )}
            {raw.length > 0 && !isValid && (
              <View style={styles.previewRow}>
                <Ionicons name="information-circle-outline" size={15} color="#9AAA9A" />
                <Text style={[styles.previewText, { color: "#9AAA9A" }]}>
                  Enter at least 2 letters
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── CTA (sticky at bottom) ── */}
        <View style={[styles.actions, { paddingBottom: insets.bottom + 20 }]}>
          <TouchableOpacity
            style={[styles.ctaBtn, !isValid && styles.ctaBtnDisabled]}
            onPress={handleContinue}
            activeOpacity={isValid ? 0.87 : 1}
          >
            <Text style={styles.ctaTxt}>Continue</Text>
            <Ionicons name="arrow-forward-circle" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  // Header (mirrors onboarding.tsx)
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 14,
    paddingTop: 12,
  },
  headerSide: { flex: 1 },
  brandRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon:  { width: 30, height: 30, borderRadius: 8 },
  brandName: {
    fontSize:      17,
    fontFamily:    "Inter_700Bold",
    color:         "#0C120E",
    letterSpacing: -0.3,
  },
  brandKenya: { color: FLAG_RED },
  skipTxt: {
    fontSize:          13,
    fontFamily:        "Inter_500Medium",
    color:             "#9AAA9A",
    paddingVertical:   4,
    paddingHorizontal: 8,
  },

  // Body
  body: {
    flex:              1,
    alignItems:        "center",
    justifyContent:    "center",
    paddingHorizontal: 32,
    gap:               20,
    paddingBottom:     24,
  },

  heroWrap: {
    width:           96,
    height:          96,
    borderRadius:    28,
    backgroundColor: GREEN + "0F",
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    4,
  },
  heroEmoji: { fontSize: 52, lineHeight: 60 },

  headline: {
    fontSize:      34,
    fontFamily:    "Inter_700Bold",
    color:         GREEN,
    textAlign:     "center",
    lineHeight:    42,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize:   15,
    fontFamily: "Inter_400Regular",
    color:      "#5F6B62",
    textAlign:  "center",
    lineHeight: 22,
  },

  // Input
  inputWrap: {
    width: "100%",
    gap:   8,
  },
  input: {
    width:             "100%",
    backgroundColor:   "#FFFFFF",
    borderRadius:      16,
    borderWidth:       1.5,
    borderColor:       "#C8E6D5",
    paddingHorizontal: 20,
    paddingVertical:   16,
    fontSize:          22,
    fontFamily:        "Inter_600SemiBold",
    color:             "#0C120E",
    textAlign:         "center",
    letterSpacing:     1,
  },
  inputValid: {
    borderColor: GREEN,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  previewRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            5,
  },
  previewText: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    color:      "#5F6B62",
  },
  previewName: {
    fontFamily: "Inter_700Bold",
    color:      GREEN,
  },

  // CTA
  actions: {
    paddingHorizontal: 24,
  },
  ctaBtn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 18,
    borderRadius:    20,
    backgroundColor: GREEN,
    shadowColor:     GREEN,
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.25,
    shadowRadius:    14,
    elevation:       8,
  },
  ctaBtnDisabled: {
    backgroundColor: "#C8E6D5",
    shadowOpacity:   0,
    elevation:       0,
  },
  ctaTxt: {
    fontSize:      17,
    fontFamily:    "Inter_700Bold",
    color:         "#FFF",
    letterSpacing: 0.2,
  },
});
