/**
 * BackgroundLocationDisclosureModal
 *
 * Google Play and Apple App Store both require a "prominent disclosure" to be
 * shown to the user BEFORE the OS background-location runtime prompt fires.
 * It must explain:
 *   - what data is collected (GPS location)
 *   - why it is needed (keep live-share position updates running when screen
 *     is locked)
 *   - that it is only used while Live Trip Sharing is active
 *
 * Show this once — the first time the driver taps "Start Live Sharing".
 * After they acknowledge it, set the AsyncStorage flag so it never appears
 * again.  The OS background-location prompt follows immediately after.
 */
import React from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export const BG_LOCATION_DISCLOSED_KEY = "sdk_bg_location_disclosed";

interface Props {
  visible: boolean;
  /** User tapped Allow — caller should set AsyncStorage flag then request permission */
  onAllow: () => void;
  /** User tapped Not Now — caller should close without requesting permission */
  onDismiss: () => void;
}

export default function BackgroundLocationDisclosureModal({
  visible,
  onAllow,
  onDismiss,
}: Props) {
  const c = useColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* Dim backdrop — tap to dismiss */}
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={[styles.sheet, { backgroundColor: c.card }]}>
        {/* Drag handle */}
        <View style={[styles.handle, { backgroundColor: c.border }]} />

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: c.primary + "18" }]}>
          <Ionicons name="location" size={32} color={c.primary} />
        </View>

        {/* Heading */}
        <Text style={[styles.title, { color: c.foreground }]}>
          Background location
        </Text>

        {/* Prominent disclosure body — must be readable before the OS prompt */}
        <Text style={[styles.body, { color: c.mutedForeground }]}>
          <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold" }}>
            Msafiri will access your location in the background
          </Text>{" "}
          while Live Trip Sharing is active.
        </Text>

        <Text style={[styles.body, { color: c.mutedForeground, marginTop: 8 }]}>
          This keeps your GPS position, speed, and estimated arrival time
          updating for the people following your trip — even when your screen
          is locked or you switch to another app.
        </Text>

        <Text style={[styles.body, { color: c.mutedForeground, marginTop: 8 }]}>
          Background location is{" "}
          <Text style={{ fontFamily: "Inter_600SemiBold", color: c.foreground }}>
            only active while a live share session is running
          </Text>
          . It stops the moment you end the share.
        </Text>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: c.border }]} />

        {/* Actions */}
        <TouchableOpacity
          style={[styles.allowBtn, { backgroundColor: c.primary }]}
          onPress={onAllow}
          activeOpacity={0.85}
        >
          <Text style={styles.allowBtnText}>Allow background location</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.dismissBtn, { borderColor: c.border }]}
          onPress={onDismiss}
          activeOpacity={0.7}
        >
          <Text style={[styles.dismissBtnText, { color: c.mutedForeground }]}>
            Not now
          </Text>
        </TouchableOpacity>

        {/* Bottom safe-area spacer */}
        <View style={{ height: Platform.OS === "ios" ? 24 : 8 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 0,
    // Shadow (iOS)
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    // Elevation (Android)
    elevation: 16,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 14,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 20,
  },
  allowBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  allowBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  dismissBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: "center",
  },
  dismissBtnText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});
