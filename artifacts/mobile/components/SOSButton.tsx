/**
 * SOSButton — sends an emergency alert via the Msafiri server (Twilio SMS)
 * to all saved emergency contacts.
 *
 * If the server call fails, falls back to opening the native SMS composer
 * with `sosContact` (the legacy single-contact stored in AppContext).
 */
import React, { useRef } from "react";
import { Alert, Animated, Platform, StyleSheet, Text, TouchableOpacity } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { apiPost } from "@/utils/apiClient";

interface Props {
  compact?: boolean;
  small?: boolean;
}

export default function SOSButton({ compact = false, small = false }: Props) {
  const colors = useColors();
  const { deviceId, driverName, sosContact, currentLat, currentLng } = useApp();
  const scale = useRef(new Animated.Value(1)).current;
  const sending = useRef(false);

  const pulse = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 70, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.08, duration: 70, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
  };

  const dispatchViaSms = async () => {
    if (!sosContact) return false;
    if (Platform.OS === "web") return false;
    try {
      const SMS = await import("expo-sms");
      const available = await SMS.isAvailableAsync();
      if (!available) return false;
      const locText = currentLat && currentLng
        ? `https://maps.google.com/?q=${currentLat.toFixed(5)},${currentLng.toFixed(5)}`
        : "Location unavailable";
      await SMS.sendSMSAsync(
        [sosContact.phone],
        `EMERGENCY – I need help!\nLocation: ${locText}\n\nSent via Msafiri Kenya`
      );
      return true;
    } catch {
      return false;
    }
  };

  const handlePress = async () => {
    if (sending.current) return;
    pulse();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    if (!deviceId) {
      Alert.alert("Not Ready", "App is still loading. Please try again in a moment.");
      return;
    }

    Alert.alert(
      "🚨 Send SOS Alert?",
      "An emergency SMS will be sent to all your saved contacts with your current location.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send SOS",
          style: "destructive",
          onPress: async () => {
            if (sending.current) return;
            sending.current = true;
            try {
              const lat = currentLat ?? -1.2921;
              const lng = currentLng ?? 36.8219;

              const res = await apiPost<{ sent: number; total: number; message?: string }>(
                "/emergency/alert",
                { deviceId, lat, lng, driverName, isTest: false },
                12_000
              );

              if (res.sent > 0) {
                Alert.alert(
                  "SOS Sent ✓",
                  `Alert sent to ${res.sent} contact${res.sent !== 1 ? "s" : ""}. Help is on the way.`
                );
              } else if ((res.total ?? 0) === 0) {
                // No contacts on server — try native SMS fallback
                const smsSent = await dispatchViaSms();
                if (!smsSent) {
                  Alert.alert(
                    "No Emergency Contacts",
                    "You haven't added any emergency contacts yet. Go to Profile → Emergency Contacts to add them.",
                    [{ text: "OK" }]
                  );
                }
              } else {
                // Contacts exist but none delivered (Twilio issue)
                const smsSent = await dispatchViaSms();
                if (!smsSent) {
                  Alert.alert(
                    "Delivery Issue",
                    "The server couldn't send the alert. Please call your emergency contact directly."
                  );
                }
              }
            } catch {
              // Network / server error — try native SMS fallback
              const smsSent = await dispatchViaSms();
              if (!smsSent) {
                Alert.alert(
                  "Connection Error",
                  "Couldn't reach the Msafiri server. Please call your emergency contact directly."
                );
              }
            } finally {
              sending.current = false;
            }
          },
        },
      ]
    );
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          compact ? (small ? styles.btnCompactSmall : styles.btnCompact) : styles.btn,
          { backgroundColor: colors.speedDanger },
        ]}
        onPress={handlePress}
        activeOpacity={0.85}
        testID="sos-button"
      >
        <Text style={compact ? (small ? styles.sosTextSmall : styles.sosTextCompact) : styles.sosText}>
          SOS
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 58, height: 58, borderRadius: 29,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#FF3D00", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.65, shadowRadius: 10, elevation: 10,
  },
  btnCompact: {
    width: 52, height: 42, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#FF3D00", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 6, elevation: 6,
  },
  btnCompactSmall: {
    width: 44, height: 36, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#FF3D00", shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5, shadowRadius: 4, elevation: 5,
  },
  sosText:        { fontSize: 15, fontWeight: "900", color: "#FFF", letterSpacing: 1 },
  sosTextCompact: { fontSize: 14, fontWeight: "900", color: "#FFF", letterSpacing: 0.8 },
  sosTextSmall:   { fontSize: 12, fontWeight: "900", color: "#FFF", letterSpacing: 0.6 },
});
