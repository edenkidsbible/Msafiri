import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Linking,
  ScrollView,
  Image,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";

const BRAND = "#4F46E5";

export default function ForceUpdateScreen() {
  const params = useLocalSearchParams<{
    latestVersion?: string;
    releaseNotes?: string;
    storeUrlIos?: string;
    storeUrlAndroid?: string;
    isSoft?: string;
  }>();

  const isForced = params.isSoft !== "true";
  const storeUrl =
    Platform.OS === "ios"
      ? (params.storeUrlIos ?? "https://apps.apple.com")
      : (params.storeUrlAndroid ?? "https://play.google.com");

  const handleUpdate = () => {
    Linking.openURL(storeUrl).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Icon */}
        <View style={styles.iconWrap}>
          <View style={styles.iconBg}>
            <Ionicons name="arrow-up-circle" size={48} color={BRAND} />
          </View>
        </View>

        <Text style={styles.title}>
          {isForced
            ? "A fresh Msafiri is waiting 🚀"
            : `Msafiri${params.latestVersion ? ` v${params.latestVersion}` : ""} is here ✨`}
        </Text>
        <Text style={styles.subtitle}>
          {isForced
            ? `Drivers on v${params.latestVersion || "the latest version"} are already on the road with the newest experience. Take 30 seconds to update and join them.`
            : `A new version of Msafiri is available${params.latestVersion ? ` (v${params.latestVersion})` : ""}. Update now for the latest features and safety improvements.`}
        </Text>

        {!!params.releaseNotes && (
          <View style={styles.notesCard}>
            <View style={styles.notesHeader}>
              <Ionicons name="list-circle-outline" size={16} color={BRAND} />
              <Text style={styles.notesTitle}>
                What&apos;s new{params.latestVersion ? ` in v${params.latestVersion}` : ""}
              </Text>
            </View>
            <Text style={styles.notesText}>{params.releaseNotes}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.updateBtn} onPress={handleUpdate} activeOpacity={0.85}>
          <Ionicons name="download-outline" size={20} color="#fff" />
          <Text style={styles.updateBtnText}>
            Update on {Platform.OS === "ios" ? "App Store" : "Google Play"}
          </Text>
        </TouchableOpacity>

        {!isForced && (
          <Text style={styles.skipHint}>
            You can continue using the current version for now.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FF",
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 48,
  },
  iconWrap: {
    marginBottom: 28,
  },
  iconBg: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    marginBottom: 12,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 15,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
    fontFamily: "Inter_400Regular",
  },
  notesCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  notesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  notesTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: BRAND,
    fontFamily: "Inter_600SemiBold",
  },
  notesText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
    fontFamily: "Inter_400Regular",
  },
  updateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: BRAND,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: "100%",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  updateBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  skipHint: {
    fontSize: 13,
    color: "#9CA3AF",
    textAlign: "center",
    fontFamily: "Inter_400Regular",
  },
});
