import React, { useCallback, useState } from "react";
import {
  Alert,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";

export default function VehicleShareCodeScreen() {
  const c      = useColors();
  const insets = useSafeAreaInsets();
  const { shareCode, vehicleName, plateNumber } = useLocalSearchParams<{
    shareCode: string;
    vehicleName: string;
    plateNumber?: string;
  }>();

  const [copied, setCopied] = useState(false);

  /** Display code with "MSF-" prefix and space in middle: MSF-AB3C2 */
  const displayCode = shareCode ? `MSF-${shareCode}` : "—";
  const plateDisplay = plateNumber ? ` (${plateNumber})` : "";

  const handleCopy = useCallback(async () => {
    if (!shareCode) return;
    await Clipboard.setStringAsync(displayCode);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2500);
  }, [shareCode, displayCode]);

  const handleShare = useCallback(async () => {
    if (!shareCode) return;
    try {
      await Share.share({
        message: `Join my ${vehicleName}${plateDisplay} on Msafiri Kenya!\n\nUse code: ${displayCode}\n\nOpen Msafiri → Garage → Join a Shared Vehicle → enter this code.`,
        title: "Join my car on Msafiri",
      });
    } catch {
      // user cancelled — ignore
    }
  }, [shareCode, vehicleName, plateDisplay, displayCode]);

  return (
    <View style={[styles.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Share Vehicle</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>

        {/* Vehicle name */}
        <View style={[styles.vehicleChip, { backgroundColor: c.primary + "12", borderColor: c.primary + "30" }]}>
          <Ionicons name="car-outline" size={16} color={c.primary} />
          <Text style={[styles.vehicleChipTxt, { color: c.primary }]} numberOfLines={1}>
            {vehicleName}{plateDisplay}
          </Text>
        </View>

        {/* Code display */}
        <View style={[styles.codeCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.codeLabel, { color: c.mutedForeground }]}>Share Code</Text>
          <Text style={[styles.codeText, { color: c.foreground }]}>{displayCode}</Text>
          <Text style={[styles.codeSub, { color: c.mutedForeground }]}>
            Valid until you regenerate it
          </Text>
        </View>

        {/* Action buttons */}
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: copied ? "#22C55E" : c.primary }]}
          onPress={handleCopy}
          activeOpacity={0.85}
        >
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color="#fff" />
          <Text style={styles.btnTxt}>{copied ? "Copied!" : "Copy Code"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnOutline, { borderColor: c.border, backgroundColor: c.card }]}
          onPress={handleShare}
          activeOpacity={0.85}
        >
          <Ionicons name="share-social-outline" size={18} color={c.foreground} />
          <Text style={[styles.btnOutlineTxt, { color: c.foreground }]}>Share via WhatsApp / SMS</Text>
        </TouchableOpacity>

        {/* Privacy summary */}
        <View style={[styles.privacyCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.privacyTitle, { color: c.foreground }]}>What co-drivers can see</Text>

          <View style={styles.privacySection}>
            <Text style={[styles.privacySectionTitle, { color: "#22C55E" }]}>✓ Shared</Text>
            {["Total distance driven by this car", "Combined drive session count", "Vehicle odometer & service intervals"].map(item => (
              <Text key={item} style={[styles.privacyItem, { color: c.mutedForeground }]}>• {item}</Text>
            ))}
          </View>

          <View style={styles.privacySection}>
            <Text style={[styles.privacySectionTitle, { color: c.mutedForeground }]}>🔒 Always private</Text>
            {["Your trip routes (where you drove)", "Your speed & driving behaviour", "Your fine records", "Your crash reports", "Your personal information"].map(item => (
              <Text key={item} style={[styles.privacyItem, { color: c.mutedForeground }]}>• {item}</Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection:     "row",
    alignItems:        "center",
    paddingHorizontal: 16,
    paddingVertical:   14,
    borderBottomWidth: 1,
  },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_600SemiBold" },

  body: {
    flex:              1,
    paddingHorizontal: 20,
    paddingTop:        24,
    gap:               16,
  },

  vehicleChip: {
    flexDirection:     "row",
    alignItems:        "center",
    alignSelf:         "center",
    gap:               8,
    paddingVertical:   8,
    paddingHorizontal: 16,
    borderRadius:      20,
    borderWidth:       1,
  },
  vehicleChipTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", maxWidth: 260 },

  codeCard: {
    alignItems:        "center",
    paddingVertical:   28,
    paddingHorizontal: 24,
    borderRadius:      20,
    borderWidth:       1,
    gap:               6,
  },
  codeLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  codeText: {
    fontSize:      38,
    fontFamily:    "Inter_700Bold",
    letterSpacing: 4,
  },
  codeSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  btn: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 16,
    borderRadius:    16,
  },
  btnTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },

  btnOutline: {
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    paddingVertical: 16,
    borderRadius:    16,
    borderWidth:     1,
  },
  btnOutlineTxt: { fontSize: 16, fontFamily: "Inter_600SemiBold" },

  privacyCard: {
    borderRadius: 16,
    borderWidth:  1,
    padding:      16,
    gap:          12,
  },
  privacyTitle:        { fontSize: 14, fontFamily: "Inter_700Bold" },
  privacySection:      { gap: 4 },
  privacySectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  privacyItem:         { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
