/**
 * OfflineSyncBanner
 *
 * Small inline banner shown on the Trips screen when the device is offline
 * or there are pending mutations waiting to sync.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface OfflineSyncBannerProps {
  isOffline: boolean;
  pendingCount: number;
}

export default function OfflineSyncBanner({ isOffline, pendingCount }: OfflineSyncBannerProps) {
  const c = useColors();

  if (!isOffline && pendingCount === 0) return null;

  const message = isOffline
    ? pendingCount > 0
      ? `Offline – ${pendingCount} change${pendingCount === 1 ? "" : "s"} will sync when connected`
      : "Offline – changes will sync when connected"
    : `Syncing ${pendingCount} pending change${pendingCount === 1 ? "" : "s"}…`;

  return (
    <View style={[styles.banner, { backgroundColor: c.card, borderColor: c.border }]}>
      <Ionicons
        name={isOffline ? "cloud-offline-outline" : "cloud-upload-outline"}
        size={14}
        color={c.mutedForeground}
        style={{ marginTop: 1 }}
      />
      <Text style={[styles.text, { color: c.mutedForeground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  text: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
});
