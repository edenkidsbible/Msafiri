/**
 * Delete My Data screen.
 *
 * Explains clearly what gets deleted and what doesn't, then requires
 * the user to type "DELETE" before the request is sent.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { apiDelete } from "@/utils/apiClient";
export { ErrorBoundary } from "@/components/ErrorBoundary";

// ── What gets deleted / kept ───────────────────────────────────────────────────
const DELETED_ITEMS: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; detail: string }[] = [
  { icon: "navigate-outline",     label: "Trip history & routes",    detail: "All past drive sessions and planned trips" },
  { icon: "location-outline",     label: "Saved places",             detail: "Home, work, and any custom saved locations" },
  { icon: "warning-outline",      label: "Community reports",        detail: "All road hazard, police, and incident reports you submitted" },
  { icon: "videocam-outline",     label: "Dashcam clip records",     detail: "Clip metadata and thumbnails (not the video files stored locally on your device)" },
  { icon: "car-outline",          label: "Vehicle data",             detail: "Saved vehicle profiles and drive statistics" },
  { icon: "alert-circle-outline", label: "Crash & accident records", detail: "Incident documentation, photos, and witness details" },
  { icon: "book-outline",         label: "Course progress",          detail: "Learning progress and bookmarks in the Msafiri Academy" },
  { icon: "shield-outline",       label: "Emergency contacts",       detail: "Your saved SOS contacts" },
  { icon: "server-outline",       label: "Cloud backup data",        detail: "All server-side backup snapshots tied to this device" },
];

const KEPT_ITEMS: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; detail: string }[] = [
  { icon: "film-outline",         label: "Local dashcam video files", detail: "Videos saved on your phone are not affected — delete them via the Dashcam screen" },
  { icon: "card-outline",         label: "Subscription / billing",   detail: "Manage or cancel your plan via App Store or Google Play settings" },
  { icon: "settings-outline",     label: "App preferences",          detail: "Theme, notification, and audio settings remain on this device" },
];

function ItemRow({ icon, label, detail, color }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; detail: string; color: string }) {
  const c = useColors();
  return (
    <View style={styles.itemRow}>
      <View style={[styles.itemIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.itemLabel, { color: c.foreground }]}>{label}</Text>
        <Text style={[styles.itemDetail, { color: c.mutedForeground }]}>{detail}</Text>
      </View>
    </View>
  );
}

export default function DeleteDataScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { deviceId } = useApp();
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  const confirmed = confirmText.trim().toUpperCase() === "DELETE";

  const handleDelete = async () => {
    if (!confirmed || !deviceId) return;
    Alert.alert(
      "Are you absolutely sure?",
      "This cannot be undone. All your Msafiri data will be permanently erased from our servers.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, delete everything",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await apiDelete("/account/data", { deviceId });
              // Clear local caches too
              await AsyncStorage.multiRemove(
                (await AsyncStorage.getAllKeys()).filter(k =>
                  k.startsWith("msafiri_") || k.startsWith("savedVehicles") ||
                  k.startsWith("recentSearches") || k.startsWith("quickStart")
                )
              ).catch(() => {});
              Alert.alert(
                "Data deleted",
                "Your Msafiri data has been permanently removed from our servers.",
                [{ text: "OK", onPress: () => router.replace("/(tabs)") }]
              );
            } catch (err: any) {
              Alert.alert("Error", err?.message ?? "Could not delete data. Please check your connection and try again.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: c.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Delete My Data</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      >
        {/* Warning hero */}
        <View style={[styles.warnBanner, { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" }]}>
          <View style={[styles.warnIconWrap, { backgroundColor: "#EF444418" }]}>
            <Ionicons name="trash" size={28} color="#EF4444" />
          </View>
          <Text style={[styles.warnTitle, { color: "#991B1B" }]}>Permanent & irreversible</Text>
          <Text style={[styles.warnBody, { color: "#7F1D1D" }]}>
            Once you delete your data it cannot be recovered. We do not keep backups of deleted accounts.
            Make sure you have exported anything you want to keep before proceeding.
          </Text>
        </View>

        {/* What gets deleted */}
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>What will be deleted</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {DELETED_ITEMS.map((item, i) => (
            <View key={item.label}>
              <ItemRow {...item} color="#EF4444" />
              {i < DELETED_ITEMS.length - 1 && (
                <View style={[styles.divider, { backgroundColor: c.border }]} />
              )}
            </View>
          ))}
        </View>

        {/* What is kept */}
        <Text style={[styles.sectionTitle, { color: c.foreground, marginTop: 24 }]}>What will NOT be deleted</Text>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {KEPT_ITEMS.map((item, i) => (
            <View key={item.label}>
              <ItemRow {...item} color="#22C55E" />
              {i < KEPT_ITEMS.length - 1 && (
                <View style={[styles.divider, { backgroundColor: c.border }]} />
              )}
            </View>
          ))}
        </View>

        {/* Confirmation input */}
        <View style={[styles.confirmBox, { backgroundColor: c.card, borderColor: "#EF4444" + "55" }]}>
          <Text style={[styles.confirmLabel, { color: c.foreground }]}>
            Type <Text style={{ fontFamily: "Inter_700Bold", color: "#EF4444" }}>DELETE</Text> to confirm
          </Text>
          <TextInput
            style={[styles.confirmInput, {
              backgroundColor: c.background,
              borderColor: confirmed ? "#EF4444" : c.border,
              color: c.foreground,
            }]}
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="Type DELETE here"
            placeholderTextColor={c.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={[
            styles.deleteBtn,
            {
              backgroundColor: confirmed ? "#EF4444" : c.muted,
              opacity: loading ? 0.7 : 1,
            },
          ]}
          onPress={handleDelete}
          disabled={!confirmed || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="trash-outline" size={18} color={confirmed ? "#FFF" : c.mutedForeground} />
              <Text style={[styles.deleteBtnTxt, { color: confirmed ? "#FFF" : c.mutedForeground }]}>
                Delete All My Data
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={[styles.footer, { color: c.mutedForeground }]}>
          Questions? Contact us at support@msafirikenya.com before proceeding.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn:     { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_700Bold" },

  content: { padding: 16 },

  warnBanner:   { borderRadius: 20, borderWidth: 1.5, padding: 20, marginBottom: 24, alignItems: "center", gap: 10 },
  warnIconWrap: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  warnTitle:    { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  warnBody:     { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 10 },

  card:    { borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 4 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  itemIcon:{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  itemLabel:  { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  itemDetail: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },

  confirmBox:   { borderRadius: 16, borderWidth: 1.5, padding: 16, marginTop: 24, gap: 10 },
  confirmLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  confirmInput: {
    borderRadius: 12, borderWidth: 1.5,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontFamily: "Inter_700Bold",
    letterSpacing: 2,
  },

  deleteBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 18, paddingVertical: 17, marginTop: 16,
  },
  deleteBtnTxt: { fontSize: 16, fontFamily: "Inter_700Bold" },

  footer: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 20, lineHeight: 18 },
});
