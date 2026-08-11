/**
 * OfflineAlertBanner
 *
 * A small pill shown at the bottom of the drive screen whenever the device
 * has no internet connection. Tapping it opens a bottom sheet that explains
 * exactly which alert features still work offline and which need mobile data.
 */
import React, { useCallback, useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatSyncAge(syncedAt: Date | null): string {
  if (!syncedAt) return "never synced";
  const diffMs  = Date.now() - syncedAt.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  return diffH < 24 ? `${diffH}h ago` : "over a day ago";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Row({
  ok,
  label,
  sub,
}: {
  ok: boolean;
  label: string;
  sub?: string;
}) {
  const c = useColors();
  return (
    <View style={sheet.row}>
      <View style={[sheet.rowIcon, { backgroundColor: ok ? "#22C55E20" : "#EF444420" }]}>
        <Ionicons
          name={ok ? "checkmark-circle" : "close-circle"}
          size={20}
          color={ok ? "#22C55E" : "#EF4444"}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[sheet.rowLabel, { color: c.foreground }]}>{label}</Text>
        {sub ? <Text style={[sheet.rowSub, { color: c.mutedForeground }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  lastSyncedAt: Date | null;
  /** Compact mode: smaller text, tighter padding. Use on the map screen where
   *  vertical space is shared with map controls. The info sheet is unchanged. */
  compact?: boolean;
  /** Override the absolute bottom offset (defaults to insets.bottom + 90 for
   *  the drive screen; map screen passes its own offset to avoid UI overlap). */
  bottomOffset?: number;
  /** When provided the pill anchors to the TOP of its container instead of the
   *  bottom. Pass insets.top + header height so it sits just below the header. */
  topOffset?: number;
}

export default function OfflineAlertBanner({ lastSyncedAt, compact = false, bottomOffset, topOffset }: Props) {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const syncAge = formatSyncAge(lastSyncedAt);
  const hasSynced = lastSyncedAt !== null;

  const resolvedBottom = bottomOffset ?? insets.bottom + 90;

  const openSettings = useCallback(() => {
    if (Platform.OS === "ios") {
      Linking.openURL("App-Prefs:").catch(() =>
        Linking.openURL("app-settings:").catch(() => {})
      );
    } else {
      Linking.openSettings().catch(() => {});
    }
  }, []);

  return (
    <>
      {/* ── Pill ──────────────────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        style={[
          sheet.pill,
          compact && sheet.pillCompact,
          {
            backgroundColor: "#7C3AED18",
            borderColor: "#7C3AED40",
            ...(topOffset !== undefined
              ? { top: topOffset }
              : { bottom: resolvedBottom }),
          },
        ]}
        accessibilityLabel="Offline mode — tap for details"
        accessibilityRole="button"
      >
        <Ionicons name="cloud-offline-outline" size={compact ? 12 : 14} color="#7C3AED" />
        <Text style={[sheet.pillTxt, compact && sheet.pillTxtCompact, { color: "#7C3AED" }]}>
          Offline
          {hasSynced ? ` · data from ${syncAge}` : " · no data yet"}
        </Text>
        <Ionicons name="information-circle-outline" size={compact ? 11 : 13} color="#7C3AED" />
      </TouchableOpacity>

      {/* ── Info sheet ────────────────────────────────────────────────── */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={sheet.overlay} onPress={() => setOpen(false)}>
          <Pressable
            style={[sheet.sheetWrap, { backgroundColor: c.card, borderColor: c.border, paddingBottom: insets.bottom + 24 }]}
            onPress={() => {}} // prevent overlay tap-through
          >
            {/* Handle */}
            <View style={[sheet.handle, { backgroundColor: c.border }]} />

            {/* Header */}
            <View style={sheet.headerRow}>
              <View style={sheet.headerIcon}>
                <Ionicons name="cloud-offline-outline" size={22} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[sheet.headerTitle, { color: c.foreground }]}>Offline Mode</Text>
                <Text style={[sheet.headerSub, { color: c.mutedForeground }]}>
                  {hasSynced
                    ? `Alert data last synced ${syncAge}. Driving alerts are still active.`
                    : "No alert data synced yet. Connect to mobile data before driving for best coverage."}
                </Text>
              </View>
            </View>

            <View style={[sheet.divider, { backgroundColor: c.border }]} />

            {/* What works */}
            <Text style={[sheet.sectionLabel, { color: c.mutedForeground }]}>WHAT WORKS OFFLINE</Text>
            <ScrollView
              scrollEnabled={false}
              contentContainerStyle={sheet.rows}
            >
              <Row
                ok
                label="Speed camera & zone alerts"
                sub="Bundled into the app — always available, no internet needed"
              />
              <Row
                ok
                label="Community hazard reports"
                sub={hasSynced ? `Using reports from ${syncAge} — new reports from other drivers won't appear` : "Will work once you've synced at least once"}
              />
              <Row
                ok
                label="GPS & location tracking"
                sub="Works entirely on-device — no data needed"
              />
              <Row
                ok
                label="Trip recording"
                sub="Saved locally and synced to your garage when you reconnect"
              />
            </ScrollView>

            <View style={[sheet.divider, { backgroundColor: c.border }]} />

            {/* What's missing */}
            <Text style={[sheet.sectionLabel, { color: c.mutedForeground }]}>WHAT REQUIRES MOBILE DATA</Text>
            <ScrollView scrollEnabled={false} contentContainerStyle={sheet.rows}>
              <Row
                ok={false}
                label="Live hazard updates from other drivers"
                sub="New potholes, police, accidents shared by the community"
              />
              <Row
                ok={false}
                label="Sending your own road reports"
                sub="Saved and will retry automatically when you reconnect"
              />
              <Row
                ok={false}
                label="HERE traffic incident data"
                sub="Live traffic and incident feeds require a connection"
              />
              <Row
                ok={false}
                label="Dashcam clip uploads"
                sub="Clips stay on your device and upload when back online"
              />
            </ScrollView>

            <View style={[sheet.divider, { backgroundColor: c.border }]} />

            {/* CTA */}
            <TouchableOpacity
              style={[sheet.ctaBtn, { backgroundColor: c.primary }]}
              onPress={openSettings}
              activeOpacity={0.85}
            >
              <Ionicons name="cellular-outline" size={17} color="#fff" />
              <Text style={sheet.ctaTxt}>Turn On Mobile Data</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[sheet.closeBtn, { borderColor: c.border }]}
              onPress={() => setOpen(false)}
              activeOpacity={0.8}
            >
              <Text style={[sheet.closeTxt, { color: c.mutedForeground }]}>Continue Offline</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const sheet = StyleSheet.create({
  // Pill
  pill: {
    position:          "absolute",
    // Centre horizontally: set left/right to equal margins so the pill
    // sits in the middle of the screen regardless of text length.
    left:              40,
    right:             40,
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "center",
    gap:               5,
    paddingVertical:   6,
    paddingHorizontal: 14,
    borderRadius:      20,
    borderWidth:       1,
    zIndex:            800,
  },
  pillCompact: {
    paddingVertical:   4,
    paddingHorizontal: 10,
    gap:               4,
  },
  pillTxt: {
    fontSize:   12,
    fontFamily: "Inter_600SemiBold",
  },
  pillTxtCompact: {
    fontSize: 11,
  },

  // Sheet
  overlay: {
    flex:            1,
    justifyContent:  "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheetWrap: {
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    borderWidth:          1,
    borderBottomWidth:    0,
    paddingHorizontal:    20,
    paddingTop:           12,
    gap:                  0,
  },
  handle: {
    width:        40,
    height:       4,
    borderRadius: 2,
    alignSelf:    "center",
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           12,
    marginBottom:  16,
  },
  headerIcon: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: "#7C3AED18",
    alignItems:      "center",
    justifyContent:  "center",
  },
  headerTitle: {
    fontSize:   16,
    fontFamily: "Inter_700Bold",
    marginBottom: 3,
  },
  headerSub: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  divider: {
    height:           StyleSheet.hairlineWidth,
    marginVertical:   16,
  },
  sectionLabel: {
    fontSize:        11,
    fontFamily:      "Inter_600SemiBold",
    letterSpacing:   0.8,
    marginBottom:    10,
  },
  rows: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           10,
  },
  rowIcon: {
    width:          32,
    height:         32,
    borderRadius:   8,
    alignItems:     "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize:   14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  rowSub: {
    fontSize:   12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },

  // Buttons
  ctaBtn: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            8,
    paddingVertical:   14,
    borderRadius:      14,
    marginTop:         4,
  },
  ctaTxt: {
    fontSize:   15,
    fontFamily: "Inter_700Bold",
    color:      "#fff",
  },
  closeBtn: {
    alignItems:     "center",
    justifyContent: "center",
    paddingVertical:   12,
    borderRadius:      14,
    borderWidth:        1,
    marginTop:          8,
  },
  closeTxt: {
    fontSize:   14,
    fontFamily: "Inter_500Medium",
  },
});
