import React, { useRef } from "react";
import { Alert, Animated, Platform, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

interface Props {
  // compact = smaller inline pill for use inside nav bars / action rows
  compact?: boolean;
  // small = further reduced for narrow screens (≤390pt)
  small?: boolean;
}

export default function SOSButton({ compact = false, small = false }: Props) {
  const colors = useColors();
  const { sosContact, currentLat, currentLng } = useApp();
  const scale = useRef(new Animated.Value(1)).current;

  const pulse = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.88, duration: 70, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.08, duration: 70, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
  };

  const handlePress = async () => {
    pulse();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    if (!sosContact) {
      Alert.alert("No Emergency Contact", "Please add an emergency contact in Settings first.", [
        { text: "OK" },
      ]);
      return;
    }

    const locText =
      currentLat && currentLng
        ? `https://maps.google.com/?q=${currentLat.toFixed(5)},${currentLng.toFixed(5)}`
        : "Location unavailable";

    const msg = `EMERGENCY – I need help!\nLocation: ${locText}\n\nSent via Msafiri`;

    if (Platform.OS !== "web") {
      try {
        const SMS = await import("expo-sms");
        const available = await SMS.isAvailableAsync();
        if (available) {
          await SMS.sendSMSAsync([sosContact.phone], msg);
        } else {
          Alert.alert(
            "SMS Unavailable",
            `Please call ${sosContact.name} directly at ${sosContact.phone}.`
          );
        }
      } catch {
        Alert.alert("Error", "Could not open SMS. Please call your emergency contact directly.");
      }
    } else {
      Alert.alert(
        `SOS to ${sosContact.name}`,
        `Would send:\n\n${msg}`,
        [{ text: "OK" }]
      );
    }
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
        <Ionicons
          name="call"
          size={compact ? (small ? 16 : 18) : 22}
          color="#FFFFFF"
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF3D00",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.65,
    shadowRadius: 10,
    elevation: 10,
  },
  // Square icon-only button — no text, so no paddingHorizontal needed
  btnCompact: {
    width: 42,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF3D00",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  // Further reduced for narrow screens (≤390pt)
  btnCompactSmall: {
    width: 36,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF3D00",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
});
