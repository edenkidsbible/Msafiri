import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import Svg, { Circle } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onCallEmergency: () => void;
  onCountdownExpired: () => void;
  countdownSeconds?: number;
}

const COUNTDOWN = 45;

export default function CrashDetectedModal({
  visible,
  onDismiss,
  onCallEmergency,
  onCountdownExpired,
  countdownSeconds = COUNTDOWN,
}: Props) {
  const [remaining, setRemaining] = useState(countdownSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiredRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for the ring
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulseAnim]);

  // Countdown timer
  useEffect(() => {
    if (!visible) {
      setRemaining(countdownSeconds);
      expiredRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    expiredRef.current = false;
    setRemaining(countdownSeconds);

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0 && !expiredRef.current) {
          expiredRef.current = true;
          if (intervalRef.current) clearInterval(intervalRef.current);
          // call after current render cycle
          setTimeout(() => onCountdownExpired(), 0);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [visible, countdownSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDismiss();
  }, [onDismiss]);

  const handleCallEmergency = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onCallEmergency();
  }, [onCallEmergency]);

  if (!visible) return null;

  // SVG ring
  const SIZE = 180;
  const STROKE = 10;
  const R = (SIZE - STROKE) / 2;
  const CIRCUM = 2 * Math.PI * R;
  const progress = remaining / countdownSeconds;
  const dashOffset = CIRCUM * (1 - progress);

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleDismiss} />

      <View style={styles.content}>
        {/* Warning icon */}
        <View style={styles.iconWrap}>
          <Ionicons name="warning" size={48} color="#FF3B30" />
        </View>

        <Text style={styles.title}>Are you okay?</Text>
        <Text style={styles.subtitle}>
          A possible crash was detected.{"\n"}Tap anywhere or press the button below if you're fine.
        </Text>

        {/* Countdown ring */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }], marginVertical: 24 }}>
          <Svg width={SIZE} height={SIZE}>
            {/* Track */}
            <Circle
              cx={SIZE / 2} cy={SIZE / 2} r={R}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={STROKE}
              fill="none"
            />
            {/* Progress */}
            <Circle
              cx={SIZE / 2} cy={SIZE / 2} r={R}
              stroke={remaining > 15 ? "#FF9500" : "#FF3B30"}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${CIRCUM} ${CIRCUM}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              rotation="-90"
              origin={`${SIZE / 2}, ${SIZE / 2}`}
            />
          </Svg>
          <View style={[StyleSheet.absoluteFill, styles.countdownCenter]}>
            <Text style={styles.countdownNumber}>{remaining}</Text>
            <Text style={styles.countdownLabel}>seconds</Text>
          </View>
        </Animated.View>

        <Text style={styles.alertingNote}>
          Emergency contacts will be alerted automatically if no response.
        </Text>

        {/* Buttons */}
        <TouchableOpacity style={styles.fineBtn} onPress={handleDismiss} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={22} color="#fff" />
          <Text style={styles.fineBtnText}>I'm Fine</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.emergencyBtn} onPress={handleCallEmergency} activeOpacity={0.85}>
          <Ionicons name="call" size={20} color="#FF3B30" />
          <Text style={styles.emergencyBtnText}>Call Emergency Services</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(120, 0, 0, 0.96)",
    zIndex: 9999,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  content: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    gap: 8,
  },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(255, 59, 48, 0.2)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    lineHeight: 24,
    marginTop: 4,
  },
  countdownCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNumber: {
    fontSize: 52,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 60,
  },
  countdownLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    marginTop: -4,
  },
  alertingNote: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    marginBottom: 8,
  },
  fineBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#34C759",
    borderRadius: 18,
    paddingVertical: 18,
    marginTop: 4,
  },
  fineBtnText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },
  emergencyBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: "#FF3B30",
    marginTop: 4,
  },
  emergencyBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FF3B30",
  },
});
