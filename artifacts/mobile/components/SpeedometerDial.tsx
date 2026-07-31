import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface SpeedometerDialProps {
  speed: number;
  speedLimit: number | null;
  hudMode?: boolean;
}

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 100;
const SW = 18;
const START = 145;
const SWEEP = 250;
const MAX_SPD = 200;

function cart(angle: number, radius = R): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

function arc(startAngle: number, sweepDeg: number): string {
  if (sweepDeg <= 0.5) return "";
  const clamped = Math.min(sweepDeg, SWEEP - 0.5);
  const end = startAngle + clamped;
  const s = cart(startAngle);
  const e = cart(end);
  const large = clamped > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export default function SpeedometerDial({ speed, speedLimit, hudMode = false }: SpeedometerDialProps) {
  const colors = useColors();
  // NOTE: The previous Animated.timing / animSpeed code was removed here.
  // animSpeed was never referenced in the JSX — the arc path uses the raw
  // `speed` prop directly — so the animation was dead code that ran an
  // Animated.timing callback on the JS thread on every GPS fix (1 Hz) for
  // no visual effect whatsoever. Removing it cuts ~1 Hz JS-thread wakeup.

  const clamp = Math.min(Math.max(speed, 0), MAX_SPD);
  const progressSweep = (clamp / MAX_SPD) * SWEEP;
  const bgPath = arc(START, SWEEP);
  const fgPath = arc(START, progressSweep);

  let speedColor: string;
  if (speedLimit != null) {
    if (speed > speedLimit) speedColor = colors.speedDanger;
    else if (speed > speedLimit * 0.88) speedColor = colors.speedCaution;
    else speedColor = colors.speedSafe;
  } else {
    if (speed > 100) speedColor = colors.speedDanger;
    else if (speed > 80) speedColor = colors.speedCaution;
    else speedColor = colors.speedSafe;
  }

  const limitPos = speedLimit != null && speedLimit <= MAX_SPD
    ? cart(START + (speedLimit / MAX_SPD) * SWEEP)
    : null;

  return (
    <View style={[styles.wrap, hudMode && styles.hudWrap]}>
      <Svg width={SIZE} height={SIZE}>
        {/* Track */}
        <Path d={bgPath} stroke={colors.muted} strokeWidth={SW} fill="none" strokeLinecap="round" />

        {/* Progress */}
        {fgPath ? (
          <Path d={fgPath} stroke={speedColor} strokeWidth={SW} fill="none" strokeLinecap="round" />
        ) : null}

        {/* Speed limit marker dot */}
        {limitPos ? (
          <Circle cx={limitPos.x} cy={limitPos.y} r={6} fill={colors.warning} />
        ) : null}

        {/* Inner face */}
        <Circle cx={CX} cy={CY} r={76} fill={colors.card} />
      </Svg>

      {/* Speed number overlaid in center */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.centerContent}>
          <Text
            style={[styles.speedNum, { color: speedColor, fontSize: hudMode ? 58 : 50 }]}
            testID="speed-value"
          >
            {Math.round(clamp)}
          </Text>
          <Text style={[styles.unitLabel, { color: colors.mutedForeground }]}>KM/H</Text>
        </View>
      </View>

      {/* Speed limit badge */}
      {speedLimit != null && (
        <View
          style={[
            styles.limitBadge,
            {
              backgroundColor: colors.card,
              borderColor: speed > speedLimit ? colors.speedDanger : colors.border,
            },
          ]}
        >
          <Text style={[styles.limitTitle, { color: colors.mutedForeground }]}>LIMIT</Text>
          <Text
            style={[
              styles.limitNum,
              { color: speed > speedLimit ? colors.speedDanger : colors.foreground },
            ]}
          >
            {speedLimit}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: SIZE,
    height: SIZE,
  },
  hudWrap: {
    transform: [{ scale: 1.12 }],
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  speedNum: {
    fontFamily: "Inter_700Bold",
    lineHeight: 60,
  },
  unitLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 3,
    marginTop: -2,
  },
  limitBadge: {
    position: "absolute",
    bottom: 28,
    right: 18,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignItems: "center",
    minWidth: 54,
  },
  limitTitle: {
    fontSize: 9,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.5,
  },
  limitNum: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    lineHeight: 26,
  },
});
