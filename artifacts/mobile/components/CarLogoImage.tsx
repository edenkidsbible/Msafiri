/**
 * CarLogoImage — shows a brand logo served from R2 via /car-logos/:makeId.
 *
 * Logos are transparent-background PNGs, so we render them on a white pill
 * so they're legible on both dark and light app themes.
 *
 * Falls back to the make's emoji when the logo is unavailable (404 or error).
 */
import React, { useState } from "react";
import { Image, Text, View } from "react-native";
import { API_BASE } from "@/utils/apiClient";
import { getMakeById } from "@/data/carModels";

export function getCarLogoUrl(makeId: string): string {
  return `${API_BASE}/car-logos/${encodeURIComponent(makeId)}`;
}

interface Props {
  makeId: string | null | undefined;
  /** Width of the rendered logo image */
  width: number;
  /** Height of the rendered logo image */
  height: number;
  /** Emoji shown if the logo is unavailable — defaults to make's emoji or 🚗 */
  emoji?: string;
  /** Border radius of the white backing pill (defaults to 6) */
  borderRadius?: number;
  /** Extra style on the outer container */
  style?: object;
}

export default function CarLogoImage({
  makeId, width, height, emoji, borderRadius = 6, style,
}: Props) {
  const [failed, setFailed] = useState(false);

  const fallbackEmoji = emoji ?? (makeId ? (getMakeById(makeId)?.emoji ?? "🚗") : "🚗");
  const fontSize = Math.min(width, height) * 0.6;

  if (!makeId || failed) {
    return (
      <View style={[{ width, height, alignItems: "center", justifyContent: "center" }, style]}>
        <Text style={{ fontSize, lineHeight: height }}>{fallbackEmoji}</Text>
      </View>
    );
  }

  // White pill backing makes transparent logos legible on dark backgrounds
  const paddingH = Math.round(width * 0.06);
  const paddingV = Math.round(height * 0.08);

  return (
    <View
      style={[
        {
          width: width + paddingH * 2,
          height: height + paddingV * 2,
          backgroundColor: "#FFFFFF",
          borderRadius,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        },
        style,
      ]}
    >
      <Image
        source={{ uri: getCarLogoUrl(makeId) }}
        style={{ width, height }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    </View>
  );
}
