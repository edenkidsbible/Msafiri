import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useColors } from "@/hooks/useColors";

interface Props {
  /** Full URL to the audio file, e.g. `${API_BASE}/course/audio/lesson-slug` */
  audioUrl: string;
}

function fmt(secs: number): string {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ audioUrl }: Props) {
  const colors = useColors();
  const player = useAudioPlayer({ uri: audioUrl }, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);

  const isLoading = !status.isLoaded || status.isBuffering;
  const progress =
    status.duration > 0
      ? Math.min(status.currentTime / status.duration, 1)
      : 0;

  const togglePlay = useCallback(() => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }, [status.playing, player]);

  const handleScrub = useCallback(
    (e: GestureResponderEvent) => {
      if (!trackWidth || !status.duration) return;
      const ratio = Math.max(
        0,
        Math.min(e.nativeEvent.locationX / trackWidth, 1)
      );
      player.seekTo(ratio * status.duration);
    },
    [trackWidth, status.duration, player]
  );

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.primary + "12",
          borderColor: colors.primary + "35",
        },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="headset-outline" size={14} color={colors.primary} />
        <Text style={[styles.headerText, { color: colors.primary }]}>
          Listen to this lesson
        </Text>
      </View>

      {/* Controls row */}
      <View style={styles.controls}>
        {/* Play / Pause button */}
        <TouchableOpacity
          onPress={togglePlay}
          style={[styles.playBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name={status.playing ? "pause" : "play"}
              size={16}
              color="#fff"
              style={status.playing ? undefined : { marginLeft: 2 }}
            />
          )}
        </TouchableOpacity>

        {/* Progress track + timestamps */}
        <View style={styles.right}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleScrub}
            style={styles.trackTouchable}
            onLayout={(e: LayoutChangeEvent) =>
              setTrackWidth(e.nativeEvent.layout.width)
            }
          >
            <View
              style={[
                styles.track,
                { backgroundColor: colors.primary + "28" },
              ]}
            >
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: colors.primary,
                    width: `${progress * 100}%`,
                  },
                ]}
              />
              {/* Thumb dot */}
              {progress > 0 && (
                <View
                  style={[
                    styles.thumb,
                    {
                      backgroundColor: colors.primary,
                      left: `${progress * 100}%` as any,
                    },
                  ]}
                />
              )}
            </View>
          </TouchableOpacity>

          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {fmt(status.currentTime)}
            {status.duration > 0 ? ` / ${fmt(status.duration)}` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  right: {
    flex: 1,
    gap: 6,
  },
  trackTouchable: {
    paddingVertical: 8,
  },
  track: {
    height: 4,
    borderRadius: 2,
    position: "relative",
    overflow: "visible",
  },
  fill: {
    height: 4,
    borderRadius: 2,
    position: "absolute",
    left: 0,
    top: 0,
  },
  thumb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    position: "absolute",
    top: -4,
    marginLeft: -6,
  },
  time: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
