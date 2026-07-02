import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { SpeedZone } from "@/data/speedZones";

type AlertZone = SpeedZone & { distance: number };

interface AlertBannerProps {
  zone: AlertZone;
  onDismiss: () => void;
}

const TYPE_LABELS = { camera: "Speed Camera", police: "Police Check", zone: "Speed Zone" } as const;
const TYPE_ICONS = { camera: "camera" as const, police: "person" as const, zone: "warning" as const };

export default function AlertBanner({ zone, onDismiss }: AlertBannerProps) {
  const colors = useColors();
  const slide = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 9,
    }).start();
  }, [zone.id]);

  const dist =
    zone.distance < 500
      ? `${Math.round(zone.distance)} m ahead`
      : `${(zone.distance / 1000).toFixed(1)} km ahead`;

  const urgent = zone.distance < 300;
  const bg = urgent ? colors.speedDanger : colors.warning;
  const fg = "#FFFFFF";

  return (
    <Animated.View
      style={[styles.banner, { backgroundColor: bg, transform: [{ translateY: slide }] }]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={TYPE_ICONS[zone.type]} size={26} color={fg} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.type, { color: fg }]}>{TYPE_LABELS[zone.type].toUpperCase()}</Text>
        <Text style={[styles.name, { color: fg }]} numberOfLines={1}>
          {zone.name}
        </Text>
        <Text style={[styles.detail, { color: fg }]}>
          Limit:{" "}
          <Text style={styles.bold}>{zone.speedLimit} km/h</Text>{"  ·  "}{dist}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.close}
      >
        <Ionicons name="close" size={20} color={fg} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  iconWrap: { width: 32, alignItems: "center" },
  text: { flex: 1 },
  type: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
    opacity: 0.88,
  },
  name: { fontSize: 15, fontFamily: "Inter_700Bold", marginTop: 1 },
  detail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, opacity: 0.9 },
  bold: { fontFamily: "Inter_700Bold" },
  close: { padding: 2, opacity: 0.85 },
});
